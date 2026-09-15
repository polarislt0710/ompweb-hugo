---
name: perplexity
description: >
  Search the web with omp's web_search tool, which prefers the owner's
  Perplexity OAuth login. Use when the user says Perplexity, 用 Perplexity,
  搜尋, search the web, or asks for current information. Do not iframe
  perplexity.ai. Do not claim Perplexity is unavailable.
---

# Perplexity = `web_search`

This machine is logged into Perplexity for **search only**. `webSearchOrder` starts with `perplexity`. There is no Perplexity chat model in `omp models`; that is expected.

When the user asks to use Perplexity, call **`web_search`** with their query. Do not open https://www.perplexity.ai in the browser pane (it will refuse the iframe). Do not say you cannot use Perplexity.

```
web_search
query: <the user's search>
```

Optional: `recency` = `day` | `week` | `month` | `year`.
