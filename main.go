package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const bangumiSiteKey = "bangumi"

type Config struct {
	Source SourceConfig
	Server ServerConfig
	Output OutputConfig
}

type SourceConfig struct {
	URL            string
	UpdateInterval time.Duration
	RequestTimeout time.Duration
}

type ServerConfig struct {
	Addr string
	Path string
}

type OutputConfig struct {
	File   string
	Pretty bool
}

type rawRoot struct {
	SiteMeta map[string]siteMeta `json:"siteMeta"`
	Items    []rawItem           `json:"items"`
}

type rawItem struct {
	Title          string         `json:"title"`
	TitleTranslate titleTranslate `json:"titleTranslate"`
	Type           string         `json:"type"`
	Lang           string         `json:"lang"`
	OfficialSite   string         `json:"officialSite"`
	Begin          string         `json:"begin"`
	Broadcast      string         `json:"broadcast"`
	End            string         `json:"end"`
	Comment        string         `json:"comment"`
	Sites          []rawSite      `json:"sites"`
}

type rawSite struct {
	Site string `json:"site"`
	ID   string `json:"id"`
}

type titleTranslate struct {
	ZhHans []string `json:"zh-Hans"`
}

type siteMeta struct {
	Title       string   `json:"title"`
	URLTemplate string   `json:"urlTemplate"`
	Regions     []string `json:"regions,omitempty"`
	Type        string   `json:"type"`
}

type frontendResponse struct {
	UpdatedAt string         `json:"updatedAt"`
	Source    string         `json:"source"`
	Count     int            `json:"count"`
	Items     []frontendItem `json:"items"`
}

type frontendItem struct {
	Title         string         `json:"title"`
	OriginalTitle string         `json:"originalTitle,omitempty"`
	ZhHansTitles  []string       `json:"zhHansTitles,omitempty"`
	Type          string         `json:"type,omitempty"`
	Language      string         `json:"language,omitempty"`
	OfficialSite  string         `json:"officialSite,omitempty"`
	BeginDate     string         `json:"beginDate,omitempty"`
	Broadcast     string         `json:"broadcast,omitempty"`
	Comment       string         `json:"comment,omitempty"`
	Sites         []frontendSite `json:"sites,omitempty"`
}

type frontendSite struct {
	Key     string   `json:"key"`
	ID      string   `json:"id"`
	Title   string   `json:"title,omitempty"`
	URL     string   `json:"url,omitempty"`
	Type    string   `json:"type,omitempty"`
	Regions []string `json:"regions,omitempty"`
}

type appState struct {
	mu        sync.RWMutex
	payload   []byte
	updatedAt string
	lastError string
}

func main() {
	configPath := flag.String("config", "config.toml", "path to TOML config")
	once := flag.Bool("once", false, "fetch once, write output if configured, then exit")
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	state := &appState{}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *once {
		if err := refresh(ctx, cfg, state); err != nil {
			log.Fatalf("refresh: %v", err)
		}
		log.Printf("wrote %s", outputTarget(cfg))
		return
	}

	go refreshLoop(ctx, cfg, state)

	mux := http.NewServeMux()
	mux.HandleFunc(cfg.Server.Path, state.handleData)
	mux.HandleFunc("/healthz", state.handleHealth)
	mux.Handle("/data/", http.StripPrefix("/", http.FileServer(http.Dir("."))))
	mux.Handle("/web/", http.StripPrefix("/web/", http.FileServer(http.Dir("web"))))
	mux.Handle("/", buildRootHandler(cfg.Server.Path))

	server := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("serving %s on %s", cfg.Server.Path, cfg.Server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server: %v", err)
	}
}

func defaultConfig() Config {
	return Config{
		Source: SourceConfig{
			UpdateInterval: 30 * time.Minute,
			RequestTimeout: 15 * time.Second,
		},
		Server: ServerConfig{
			Addr: ":8080",
			Path: "/api/on-air",
		},
		Output: OutputConfig{
			Pretty: true,
		},
	}
}

func loadConfig(path string) (Config, error) {
	cfg := defaultConfig()

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}

	values, err := parseSimpleTOML(string(content))
	if err != nil {
		return Config{}, err
	}

	if v := values["source.url"]; v != "" {
		cfg.Source.URL = v
	}
	if v := firstNonEmpty(values["source.update_interval"], values["source.interval"]); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("source.update_interval: %w", err)
		}
		cfg.Source.UpdateInterval = d
	}
	if v := values["source.request_timeout"]; v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Config{}, fmt.Errorf("source.request_timeout: %w", err)
		}
		cfg.Source.RequestTimeout = d
	}
	if v := values["server.addr"]; v != "" {
		cfg.Server.Addr = v
	}
	if v := values["server.path"]; v != "" {
		cfg.Server.Path = v
	}
	if v := values["output.file"]; v != "" {
		cfg.Output.File = v
	}
	if v := values["output.pretty"]; v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("output.pretty: %w", err)
		}
		cfg.Output.Pretty = b
	}

	applyEnvOverrides(&cfg)

	if cfg.Source.URL == "" {
		return Config{}, errors.New("source.url is required")
	}
	if cfg.Source.UpdateInterval <= 0 {
		return Config{}, errors.New("source.update_interval must be positive")
	}
	if cfg.Source.RequestTimeout <= 0 {
		return Config{}, errors.New("source.request_timeout must be positive")
	}
	if !strings.HasPrefix(cfg.Server.Path, "/") {
		return Config{}, errors.New("server.path must start with /")
	}

	return cfg, nil
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("BANGUMI_SOURCE_URL"); v != "" {
		cfg.Source.URL = v
	}
	if v := os.Getenv("BANGUMI_OUTPUT_FILE"); v != "" {
		cfg.Output.File = v
	}
}

func parseSimpleTOML(input string) (map[string]string, error) {
	values := make(map[string]string)
	section := ""
	lines := strings.Split(input, "\n")

	for i, line := range lines {
		line = strings.TrimSpace(stripComment(line))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, "["), "]"))
			if section == "" || strings.Contains(section, ".") {
				return nil, fmt.Errorf("line %d: invalid section", i+1)
			}
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: expected key = value", i+1)
		}

		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" {
			return nil, fmt.Errorf("line %d: empty key", i+1)
		}

		if strings.HasPrefix(value, "\"") {
			unquoted, err := strconv.Unquote(value)
			if err != nil {
				return nil, fmt.Errorf("line %d: %w", i+1, err)
			}
			value = unquoted
		}

		fullKey := key
		if section != "" {
			fullKey = section + "." + key
		}
		values[fullKey] = value
	}

	return values, nil
}

func stripComment(line string) string {
	inString := false
	escaped := false

	for i, r := range line {
		if escaped {
			escaped = false
			continue
		}
		if r == '\\' && inString {
			escaped = true
			continue
		}
		if r == '"' {
			inString = !inString
			continue
		}
		if r == '#' && !inString {
			return line[:i]
		}
	}

	return line
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func refreshLoop(ctx context.Context, cfg Config, state *appState) {
	if err := refresh(ctx, cfg, state); err != nil {
		log.Printf("initial refresh failed: %v", err)
	}

	ticker := time.NewTicker(cfg.Source.UpdateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := refresh(ctx, cfg, state); err != nil {
				log.Printf("refresh failed: %v", err)
			}
		}
	}
}

func refresh(ctx context.Context, cfg Config, state *appState) error {
	root, err := fetchRoot(ctx, cfg)
	if err != nil {
		state.setError(err)
		return err
	}

	response := buildFrontendResponse(root, cfg.Source.URL, time.Now())
	payload, err := marshalResponse(response, cfg.Output.Pretty)
	if err != nil {
		state.setError(err)
		return err
	}

	if cfg.Output.File != "" {
		if err := writeFileAtomic(cfg.Output.File, payload); err != nil {
			state.setError(err)
			return err
		}
	}

	state.setPayload(payload, response.UpdatedAt)
	log.Printf("refreshed %d active items", response.Count)
	return nil
}

func fetchRoot(ctx context.Context, cfg Config) (rawRoot, error) {
	client := &http.Client{Timeout: cfg.Source.RequestTimeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.Source.URL, nil)
	if err != nil {
		return rawRoot{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "bangumi-on-air-fetcher/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return rawRoot{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return rawRoot{}, fmt.Errorf("source returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var root rawRoot
	decoder := json.NewDecoder(resp.Body)
	if err := decoder.Decode(&root); err != nil {
		return rawRoot{}, err
	}

	return root, nil
}

func buildFrontendResponse(root rawRoot, source string, now time.Time) frontendResponse {
	items := make([]frontendItem, 0, len(root.Items))

	for _, item := range root.Items {
		if item.End != "" {
			continue
		}

		title := item.Title
		if len(item.TitleTranslate.ZhHans) > 0 && item.TitleTranslate.ZhHans[0] != "" {
			title = item.TitleTranslate.ZhHans[0]
		}

		out := frontendItem{
			Title:        title,
			ZhHansTitles: append([]string(nil), item.TitleTranslate.ZhHans...),
			Type:         item.Type,
			Language:     item.Lang,
			OfficialSite: item.OfficialSite,
			BeginDate:    item.Begin,
			Broadcast:    item.Broadcast,
			Comment:      item.Comment,
			Sites:        make([]frontendSite, 0, len(item.Sites)),
		}
		if item.Title != "" && item.Title != title {
			out.OriginalTitle = item.Title
		}

		for _, site := range item.Sites {
			if site.Site != bangumiSiteKey {
				continue
			}

			meta := root.SiteMeta[site.Site]
			out.Sites = append(out.Sites, frontendSite{
				Key:     site.Site,
				ID:      site.ID,
				Title:   meta.Title,
				URL:     fillURLTemplate(meta.URLTemplate, site.ID),
				Type:    meta.Type,
				Regions: append([]string(nil), meta.Regions...),
			})
		}

		items = append(items, out)
	}

	return frontendResponse{
		UpdatedAt: now.UTC().Format(time.RFC3339),
		Source:    source,
		Count:     len(items),
		Items:     items,
	}
}

func fillURLTemplate(template string, id string) string {
	if template == "" || id == "" {
		return ""
	}

	url := strings.ReplaceAll(template, "{{id}}", id)
	url = strings.ReplaceAll(url, "{id}", id)
	url = strings.ReplaceAll(url, "bangumi.tv", "bgm.tv")
	return url
}

func marshalResponse(response frontendResponse, pretty bool) ([]byte, error) {
	var (
		payload []byte
		err     error
	)
	if pretty {
		payload, err = json.MarshalIndent(response, "", "  ")
	} else {
		payload, err = json.Marshal(response)
	}
	if err != nil {
		return nil, err
	}
	return append(payload, '\n'), nil
}

func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	return os.Rename(tmpName, path)
}

func outputTarget(cfg Config) string {
	if cfg.Output.File != "" {
		return cfg.Output.File
	}
	return cfg.Server.Path
}

func buildRootHandler(apiPath string) http.Handler {
	indexPath := filepath.Join("web", "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		return http.FileServer(http.Dir("web"))
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"data":   apiPath,
			"health": "/healthz",
		})
	})
}

func (s *appState) setPayload(payload []byte, updatedAt string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.payload = append(s.payload[:0], payload...)
	s.updatedAt = updatedAt
	s.lastError = ""
}

func (s *appState) setError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err != nil {
		s.lastError = err.Error()
	}
}

func (s *appState) handleData(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	payload := append([]byte(nil), s.payload...)
	lastError := s.lastError
	s.mu.RUnlock()

	if len(payload) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": lastErrorOrDefault(lastError),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(payload)
}

func (s *appState) handleHealth(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	updatedAt := s.updatedAt
	lastError := s.lastError
	ok := len(s.payload) > 0 && lastError == ""
	s.mu.RUnlock()

	status := http.StatusOK
	if !ok {
		status = http.StatusServiceUnavailable
	}

	writeJSON(w, status, map[string]any{
		"ok":        ok,
		"updatedAt": updatedAt,
		"lastError": lastError,
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(bytes.TrimSpace(payload))
}

func lastErrorOrDefault(lastError string) string {
	if lastError != "" {
		return lastError
	}
	return "data is not ready"
}
