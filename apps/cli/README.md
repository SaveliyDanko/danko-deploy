# @dankodeploy/cli

JSON-first CLI для LLM-агентов, управляющих конкретным деплоем в DankoDeploy.

```bash
export DANKODEPLOY_TOKEN=ddp_...
dankodeploy init --url https://deploy.example.com --deployment <id>
dankodeploy context
dankodeploy deploy
```

Проектный `.dankodeploy.json` содержит только URL панели и `deploymentId`. Сырой токен хранится
только в окружении. Полный список команд: `dankodeploy help`. Подробная документация —
[docs/CLI.md](../../docs/CLI.md).
