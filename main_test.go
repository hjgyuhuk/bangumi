package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	t.Setenv("TZ", "UTC")

	content := `
[source]
url = "https://example.com/data.json"
update_interval = "45m"
request_timeout = "20s"

[server]
addr = ":9090"
path = "/anime"

[output]
file = "data/anime.json"
pretty = false
`

	path := t.TempDir() + "/config.toml"
	if err := writeFileAtomic(path, []byte(content)); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := loadConfig(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Source.URL != "https://example.com/data.json" {
		t.Fatalf("unexpected source URL: %q", cfg.Source.URL)
	}
	if cfg.Source.UpdateInterval != 45*time.Minute {
		t.Fatalf("unexpected update interval: %s", cfg.Source.UpdateInterval)
	}
	if cfg.Source.RequestTimeout != 20*time.Second {
		t.Fatalf("unexpected request timeout: %s", cfg.Source.RequestTimeout)
	}
	if cfg.Server.Addr != ":9090" || cfg.Server.Path != "/anime" {
		t.Fatalf("unexpected server config: %+v", cfg.Server)
	}
	if cfg.Output.File != "data/anime.json" || cfg.Output.Pretty {
		t.Fatalf("unexpected output config: %+v", cfg.Output)
	}
}

func TestLoadConfigEnvOverrides(t *testing.T) {
	t.Setenv("BANGUMI_SOURCE_URL", "https://example.com/override.json")
	t.Setenv("BANGUMI_OUTPUT_FILE", "data/override.json")

	content := `
[source]
url = "https://example.com/data.json"
update_interval = "45m"
request_timeout = "20s"

[output]
file = "data/anime.json"
`

	path := t.TempDir() + "/config.toml"
	if err := writeFileAtomic(path, []byte(content)); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := loadConfig(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Source.URL != "https://example.com/override.json" {
		t.Fatalf("unexpected source URL: %q", cfg.Source.URL)
	}
	if cfg.Output.File != "data/override.json" {
		t.Fatalf("unexpected output file: %q", cfg.Output.File)
	}
}

func TestBuildFrontendResponseFiltersActiveItems(t *testing.T) {
	root := rawRoot{
		SiteMeta: map[string]siteMeta{
			"bangumi": {
				Title:       "Bangumi",
				URLTemplate: "https://bangumi.tv/subject/{{id}}",
				Type:        "info",
			},
			"bilibili": {
				Title:       "Bilibili",
				URLTemplate: "https://www.bilibili.com/bangumi/media/{id}",
				Regions:     []string{"CN"},
				Type:        "stream",
			},
		},
		Items: []rawItem{
			{
				Title:          "Original",
				TitleTranslate: titleTranslate{ZhHans: []string{"Simplified"}},
				Type:           "tv",
				Lang:           "ja",
				Begin:          "2026-04-01T00:00:00.000Z",
				End:            "",
				Sites: []rawSite{
					{Site: "bangumi", ID: "123"},
					{Site: "bilibili", ID: "md456"},
				},
			},
			{
				Title: "Finished",
				End:   "2026-06-01T00:00:00.000Z",
			},
		},
	}

	now := time.Date(2026, 4, 23, 12, 0, 0, 0, time.UTC)
	response := buildFrontendResponse(root, "source", now)

	if response.Count != 1 || len(response.Items) != 1 {
		t.Fatalf("expected one active item, got count=%d len=%d", response.Count, len(response.Items))
	}

	item := response.Items[0]
	if item.Title != "Simplified" || item.OriginalTitle != "Original" {
		t.Fatalf("unexpected titles: %+v", item)
	}
	if len(item.Sites) != 1 {
		t.Fatalf("expected one site, got %d", len(item.Sites))
	}
	if item.Sites[0].Key != "bangumi" {
		t.Fatalf("expected bangumi site, got %q", item.Sites[0].Key)
	}
	if item.Sites[0].URL != "https://bgm.tv/subject/123" {
		t.Fatalf("unexpected bangumi URL: %q", item.Sites[0].URL)
	}
}

func TestBuildRootHandlerServesWebIndex(t *testing.T) {
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	tmp := t.TempDir()
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("chdir temp: %v", err)
	}
	defer func() {
		_ = os.Chdir(oldWD)
	}()

	if err := os.MkdirAll("web", 0o755); err != nil {
		t.Fatalf("mkdir web: %v", err)
	}
	if err := os.WriteFile("web/index.html", []byte("<!doctype html><title>weekly anime</title>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}

	handler := buildRootHandler("/api/on-air")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "weekly anime") {
		t.Fatalf("unexpected body: %q", rec.Body.String())
	}
}
