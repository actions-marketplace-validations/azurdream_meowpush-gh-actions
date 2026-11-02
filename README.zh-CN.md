# MeowPush GitHub Action

[English](README.md)

在 GitHub Actions 中发送 [MeowPush](https://docs.meowpush.com/zh/) 通知。支持 Linux、Windows、macOS 的 x64/arm64 runner，无需额外安装或配置运行环境。

## 快速开始

1. 在 [MeowPush 账户管理](https://accounts.meowpush.com/applications/) 或 MeowPush App 中创建应用，选择接收通知的设备或设备组。
2. 复制以 `mpap` 开头的**应用推送密钥**。
3. 打开 GitHub 仓库的 **Settings → Secrets and variables → Actions → New repository secret**，将密钥保存为 `MEOWPUSH_KEY`。

推荐为 CI 使用应用推送密钥。设备和设备组密钥仍可兼容使用，但不推荐。应用的接收目标可以随时调整，无需修改 workflow 中的密钥。详见 [应用指南](https://docs.meowpush.com/zh/applications/)。

```yaml
name: ci

on:
  push:

jobs:
  notify:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Send notification
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: CI 通知
          body: 来自 GitHub Actions 的通知
```

若希望通知发送失败不影响整个 workflow，在通知步骤中添加 `continue-on-error: true`，与 `uses` 同级。

接入现有 job 时，添加 `Send notification` 这一个步骤即可。此 Action 不需要 checkout 或 GitHub Token。

`@v1` 会跟随兼容更新。需要固定版本时，可使用版本标签或完整 commit SHA。

## 输入参数

推荐用法只需提供 `key` 和 `body`。可选字段与 [MeowPush API](https://docs.meowpush.com/zh/api/#send-notifications) 一致。

| 输入          | 说明                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `key`         | 推荐填写应用推送密钥，不能与 `keys` 同时使用。                                           |
| `keys`        | 为兼容设备和设备组密钥保留的 JSON 数组，最多 50 个不重复密钥。应用推送密钥只能单独使用。 |
| `body`        | 通知正文，1–4000 个字符，保留空白和换行。                                                |
| `title`       | 标题，1–256 个字符。                                                                     |
| `subtitle`    | 副标题，1–256 个字符，展示方式因平台而异。                                               |
| `level`       | `passive`、`active` 或 `time-sensitive`，默认 `active`。                                 |
| `badge`       | 角标数，0–99，`0` 表示清除角标。                                                         |
| `icon`        | HTTPS 图标地址，1–2048 个字符。                                                          |
| `image`       | HTTPS 图片地址，1–2048 个字符。                                                          |
| `url`         | 点击通知后打开的 URI，1–2048 个字符。                                                    |
| `group`       | 通知分组标识，1–64 个字符。                                                              |
| `collapse-id` | 替换此前具有相同标识的通知展示内容，格式为 `[A-Za-z0-9_-]{1,32}`。                       |
| `ttl`         | 有效期，单位秒，0–2419200，默认 `86400`。                                                |
| `data`        | 自定义 JSON 对象。                                                                       |
| `endpoint`    | 发送地址，默认 `https://send.meowpush.com/`。支持 HTTP 和 HTTPS，URL 中不能嵌入凭据。    |
| `timeout`     | Action 侧发送请求和读取响应的总超时，单位毫秒，正整数，默认 `30000`。                    |

可选输入为空时省略该字段，`badge: '0'`、`ttl: '0'` 等零值会正常发送。

### 富文本与自定义数据

将 Markdown、HTML 或 JSON 通知内容作为文本填写在 `body` 中：

```yaml
      - name: Send build details
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: 构建完成
          body: |
            ## 构建报告
            仓库：${{ github.repository }}
            提交：${{ github.sha }}

            [查看运行记录](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})
          url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          group: github-actions
          data: '{"source":"github-actions"}'
```

动态 `data` 应先将对象序列化为 JSON，避免把未转义的文本直接拼入 JSON 字符串。

## 输出与失败处理

服务端返回有效 HTTP 2xx 响应，且 **`accepted > 0`、`failed == 0`** 时步骤成功。部分失败、没有接收目标或请求出错都会使步骤失败。`accepted` 表示上游推送平台已接受通知，不代表设备已经展示。

| 输出                  | 内容                                            |
| --------------------- | ----------------------------------------------- |
| `success`             | 字符串 `true` 或 `false`。                      |
| `notification-id`     | 服务端通知 ID；无法取得时为空。                 |
| `accepted` / `failed` | 结果计数的字符串；无法取得时为空。              |
| `results`             | 移除密钥后的逐目标结果 JSON 数组，默认为 `[]`。 |
| `http-status`         | HTTP 状态码；未收到响应时为空。                 |
| `error-code`          | 错误码，成功时为空。                            |
| `error-message`       | 移除密钥后的错误说明，成功时为空。              |

步骤失败时仍会写出输出。若不希望通知失败影响 job，可在通知步骤上设置 `continue-on-error: true`，并在后续步骤读取结果：

```yaml
      - name: Notify
        id: notify
        continue-on-error: true
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          body: CI 任务完成

      - name: Inspect notification result
        env:
          NOTIFY_SUCCESS: ${{ steps.notify.outputs.success }}
          NOTIFY_ERROR: ${{ steps.notify.outputs.error-code }}
        shell: bash
        run: printf 'Notification success=%s error=%s\n' "$NOTIFY_SUCCESS" "$NOTIFY_ERROR"
```

该设置只对通知步骤生效，构建或测试失败仍会使 job 失败。通知失败时，`steps.notify.outcome` 保持为 `failure`，`conclusion` 则为 `success`。

### 构建失败时通知

在构建 job 的 `steps` 末尾追加：

```yaml
      - name: Notify build failure
        if: ${{ failure() }}
        continue-on-error: true
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: 构建失败
          body: '${{ github.workflow }} 在 ${{ github.ref_name }} 上执行失败'
          url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

如需在前面步骤成功后也发送通知，可改用 `if: ${{ always() }}`。

### 汇总多个 job，并向后续 job 传递结果

在 `jobs` 下与现有的 `build`、`test` job 并列添加以下内容。即使依赖失败或被跳过，通知 job 也会执行：

```yaml
  notify:
    needs: [build, test]
    if: ${{ always() }}
    runs-on: ubuntu-latest
    permissions: {}
    outputs:
      success: ${{ steps.send.outputs.success }}
      notification-id: ${{ steps.send.outputs.notification-id }}
    steps:
      - name: Send summary
        id: send
        continue-on-error: true
        uses: azurdream/meowpush-gh-actions@v1
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          title: CI 结果
          body: |
            ${{ github.repository }} / ${{ github.ref_name }}
            构建：${{ needs.build.result }}
            测试：${{ needs.test.result }}
          url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

  inspect-notification:
    needs: notify
    if: ${{ always() && needs.notify.result == 'success' }}
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Read notification result
        env:
          NOTIFICATION_ID: ${{ needs.notify.outputs.notification-id }}
          NOTIFY_SUCCESS: ${{ needs.notify.outputs.success }}
        shell: bash
        run: printf 'Notification %s success=%s\n' "$NOTIFICATION_ID" "$NOTIFY_SUCCESS"
```

### 逐目标结果

`results` 包含每个目标的状态、推送平台、消息标识和错误详情，来源密钥以从零开始的输入索引表示：

```json
[
  {
    "status": "accepted",
    "transport": "apns",
    "message_id": "provider-message-id",
    "key_index": 0,
    "source_key_indexes": [0]
  }
]
```

单个应用推送密钥的索引为 `0`，可以对应多个接收目标。使用 `keys` 时，索引对应数组中的位置；无法匹配的来源索引为 `null`。

### 错误码

API 的 `error.code` 会作为 `error-code` 输出。Action 检测到的错误使用以下代码：

| 错误码                      | 含义                                      |
| --------------------------- | ----------------------------------------- |
| `action_invalid_input`      | 输入缺失、冲突或格式错误。                |
| `action_timeout`            | 请求或响应读取超时。                      |
| `action_network_error`      | 连接、TLS 或响应流错误。                  |
| `action_http_error`         | 没有 API 错误码的 HTTP 错误，包括重定向。 |
| `action_invalid_response`   | 响应中没有有效的发送结果。                |
| `action_delivery_failed`    | 至少一个目标失败。                        |
| `action_no_targets`         | 没有解析到接收目标。                      |
| `action_response_too_large` | 响应或输出超过大小限制。                  |
| `action_internal_error`     | Action 无法准备请求。                     |

请求不会自动重试或跟随重定向。超时时通知可能已经发出，重新运行可能重复发送；`collapse-id` 不会对请求去重。

## 自托管 runner

需要 **2.327.1 或更新版本**的 runner，以及支持 Node.js 24 的操作系统。

需要代理或自定义 CA 时，可按需配置环境变量：

```yaml
      - uses: azurdream/meowpush-gh-actions@v1
        env:
          NODE_USE_ENV_PROXY: '1'
          HTTPS_PROXY: ${{ secrets.CI_HTTPS_PROXY }}
          NO_PROXY: localhost,127.0.0.1
          NODE_EXTRA_CA_CERTS: /etc/company/ca.pem
        with:
          key: ${{ secrets.MEOWPUSH_KEY }}
          body: 构建完成
```

CA 文件需已存在于 runner。HTTP 地址可使用 `HTTP_PROXY`。详见 [Node 网络配置](https://nodejs.org/learn/http/enterprise-network-configuration)。

## Secrets

将应用推送密钥保存在 GitHub Secrets 中，并仅发送到可信地址。HTTP 地址不会加密密钥和通知内容。

fork PR 和 Dependabot workflow 通常无法读取仓库 Secrets。密钥不可用时，应跳过通知步骤；空密钥会使输入校验失败。详见 [GitHub Secrets 指南](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)。

## 参与开发

参见 [CONTRIBUTING.md](CONTRIBUTING.md)、[发布流程](docs/releasing.md) 和 [安全政策](SECURITY.md)。

使用 [MIT 许可证](LICENSE)。
