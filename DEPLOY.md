# SunfishLoop 开发上线工作流

## 连接信息

| 环境 | 地址 | 说明 |
|------|------|------|
| **GitHub（唯一代码源）** | `git@github.com:sunfishloop/sunfishloop.git` | 本地 push、Dev/生产 pull 均用此仓库 |

## 1. 本地开发

```bash
# 首次
git clone git@github.com:sunfishloop/sunfishloop.git
cd sunfishloop

# 日常
git add .
git commit -m "你的修改说明"
git push origin main
```

## 2. Dev 验证 → 3. 生产

1. 将 GitHub `main` 部署到 **Dev**，完成功能/API/前端验证  
2. 通过后再部署 **生产**（https://sunfishloop.com）

## 注意事项

- **勿提交**：`.env`、`scripts/agent_pipeline_config.json`（见 `.gitignore`）
- **前端 CDN**：改 `app.js` / `styles.css` 后，在 `index.html` 递增查询参数，例如 `app.js?v=4`、`styles.css?v=4`
- **配置模板**：`cp scripts/agent_pipeline_config.example.json scripts/agent_pipeline_config.json` 后填入密钥（仅服务器本地）
