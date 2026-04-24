# bangumi

A small Go service that periodically fetches a Bangumi-style JSON endpoint,
keeps only items whose `end` field is empty, enriches site links from
`siteMeta`, keeps only the `bangumi` site entry, and exposes:

- API data for frontend use.
- A Kumo UI page for weekly schedule browsing.

## Configuration

Create `config.toml` from `config.example.toml`:

```toml
[source]
url = "https://example.com/api/bangumi.json"
update_interval = "30m"
request_timeout = "15s"

[server]
addr = ":8080"
path = "/api/on-air"

[output]
file = "data/on-air.json"
pretty = true
```

`source.update_interval` and `source.request_timeout` use Go duration syntax,
such as `10m`, `30m`, `1h`, or `15s`.

## Run

```sh
go run . -config config.toml
```

Fetch once and exit:

```sh
go run . -config config.toml -once
```

## GitHub Actions data updates

The repository includes `.github/workflows/update-on-air.yml`, which can update
`data/on-air.json` automatically after the project is pushed to GitHub.

It runs:

- once per day at 04:10 Asia/Shanghai
- manually from the GitHub Actions page via `workflow_dispatch`

Before relying on scheduled commits, make sure repository Actions can push:

1. Open `Settings` → `Actions` → `General`.
2. Under `Workflow permissions`, select `Read and write permissions`.

By default the workflow reads the source URL from `config.toml`. To avoid
committing a source URL, create a repository variable named
`BANGUMI_SOURCE_URL`; the Go program will use that value instead of the config
file URL.

The HTTP service exposes:

- `GET /`: Kumo UI frontend page.
- `GET /api/on-air`: converted data from the fetcher.
- `GET /data/on-air.json`: static JSON file for frontend local testing.
- `GET /healthz`: refresh status.

The frontend defaults to `GET /data/on-air.json`, then filters to
`current year + current season`:

- Winter: January to March
- Spring: April to June
- Summer: July to September
- Autumn: October to December

## Output shape

```json
{
  "updatedAt": "2026-04-23T07:30:00Z",
  "source": "https://example.com/api/bangumi.json",
  "count": 1,
  "items": [
    {
      "title": "Chinese title when available",
      "originalTitle": "Original title",
      "zhHansTitles": ["Chinese title when available"],
      "type": "tv",
      "language": "ja",
      "officialSite": "https://example.com",
      "beginDate": "2026-04-01T00:00:00.000Z",
      "broadcast": "R/2026-04-01T12:00:00.000Z/P7D",
      "comment": "",
      "sites": [
        {
          "key": "bangumi",
          "id": "123",
          "title": "Bangumi",
          "url": "https://bgm.tv/subject/123",
          "type": "info"
        }
      ]
    }
  ]
}
```
