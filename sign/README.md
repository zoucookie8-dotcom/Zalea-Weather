# 签名证书

`.rpk` 要装到手表上需要签名，证书自己生成即可（自签名就行）。

```bash
openssl req -newkey rsa:2048 -nodes \
  -keyout sign/private.pem -x509 -days 3650 -out sign/certificate.pem \
  -subj "/C=CN/O=Self/CN=vela-weather"
```

生成后 `sign/` 下应该有 `private.pem` 和 `certificate.pem` 两个文件。

**私钥不要提交到版本库** —— `sign/` 已经在 `.gitignore` 里了。

## 目录位置有分歧

文档之间说法不一致：

- 项目概览 / 使用 IDE 那几篇说证书直接放 `sign/`
- 互联互通那篇说放 `sign/debug` 和 `sign/release`

如果 `aiot build` / `aiot release` 报找不到证书，把两个文件在两个位置各放一份：

```
sign/private.pem
sign/certificate.pem
sign/debug/private.pem
sign/debug/certificate.pem
sign/release/private.pem
sign/release/certificate.pem
```

另外，**侧载到红米手表 5 是否强制要求签名，官方文档没有明确说明**。
如果装了却启动不起来，签名是第一个该怀疑的点。
