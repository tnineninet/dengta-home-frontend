package home.dengta.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Locale;

/**
 * 本地媒体代理 HTTP 服务器（Castor deliver 模式，多平台兼容）。
 *
 * 原理：视频网站 CDN 需要特定 Referer + User-Agent 才能下载。
 * 本代理在手机本地监听端口，ExoPlayer 播放 "http://127.0.0.1:port/proxy?url=..."
 * 代理从 CDN 拉流（带站点特定 headers）后透传回 ExoPlayer。
 *
 * 支持：B站 / 爱奇艺 / 腾讯视频 / 通用
 */
public final class LocalMediaProxy {

    private static final int BUFFER_SIZE = 8192;

    private final int port;
    private final ServerSocket serverSocket;
    private final Thread serverThread;
    private volatile boolean running = false;

    private LocalMediaProxy(ServerSocket serverSocket) {
        this.serverSocket = serverSocket;
        this.port = serverSocket.getLocalPort();
        this.serverThread = new Thread(this::serve, "local-media-proxy");
        serverThread.setDaemon(true);
    }

    /** 在随机端口上启动代理并返回端口号（-1 表示失败）。一次只服务一个请求。 */
    public static int startRandom() {
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                ServerSocket ss = new ServerSocket(0);
                LocalMediaProxy proxy = new LocalMediaProxy(ss);
                proxy.start();
                return proxy.port;
            } catch (Exception ignored) {
            }
        }
        return -1;
    }

    public void start() { running = true; serverThread.start(); }

    public void stop() { running = false; serverThread.interrupt(); }

    public int getPort() { return port; }

    /** 构建代理 URL。 */
    public static String buildProxyUrl(int proxyPort, String targetUrl) {
        try {
            return "http://127.0.0.1:" + proxyPort + "/proxy?url=" + URLEncoder.encode(targetUrl, "UTF-8");
        } catch (Exception e) {
            return "http://127.0.0.1:" + proxyPort + "/proxy?url=" + targetUrl;
        }
    }

    private void serve() {
        try (ServerSocket ss = serverSocket) {
            ss.setSoTimeout(30000);
            while (running) {
                try {
                    Socket client = ss.accept();
                    running = false;
                    handleClient(client);
                } catch (java.net.SocketTimeoutException ignored) {
                    break;
                } catch (IOException ignored) {
                    break;
                }
            }
        } catch (Exception ignored) {}
    }

    private void handleClient(Socket client) {
        InputStream clientIn = null;
        OutputStream clientOut = null;
        try {
            clientIn = client.getInputStream();
            clientOut = client.getOutputStream();
            client.setSoTimeout(30000);

            StringBuilder requestLine = new StringBuilder();
            int c;
            while ((c = clientIn.read()) != -1 && c != '\n' && requestLine.length() < 2048) {
                requestLine.append((char) c);
            }
            String line = requestLine.toString().trim();
            if (!line.startsWith("GET ")) {
                writeError(clientOut, 400, "Bad Request");
                return;
            }

            int httpEnd = line.lastIndexOf(" HTTP");
            if (httpEnd < 0) {
                writeError(clientOut, 400, "Bad Request");
                return;
            }
            String path = line.substring(4, httpEnd);
            String targetUrl = extractParam(path, "url");
            if (targetUrl == null || targetUrl.isEmpty()) {
                writeError(clientOut, 400, "Missing url parameter");
                return;
            }

            // 读取请求头，提取 Range（ExoPlayer seek 依赖；CDN 需要转发才能返回 206）
            String rangeHeader = null;
            String headerLine;
            int headerBytes = 0;
            while (headerBytes < 8192) {
                StringBuilder hb = new StringBuilder();
                int hc;
                while ((hc = clientIn.read()) != -1 && hc != '\n' && hb.length() < 1024) {
                    hb.append((char) hc);
                }
                headerBytes += hb.length();
                headerLine = hb.toString().trim();
                if (headerLine.isEmpty()) break;
                if (headerLine.toLowerCase(Locale.ROOT).startsWith("range:")) {
                    rangeHeader = headerLine.substring(6).trim();
                }
            }

            // 代理拉流
            proxyStream(clientOut, targetUrl, rangeHeader);
        } catch (java.net.SocketTimeoutException e) {
            try { writeError(clientOut, 504, "Gateway Timeout"); } catch (Exception ignored) {}
        } catch (Exception e) {
            try { writeError(clientOut, 502, "Bad Gateway"); } catch (Exception ignored) {}
        } finally {
            try { if (clientIn != null) clientIn.close(); } catch (Exception ignored) {}
            try { if (clientOut != null) clientOut.close(); } catch (Exception ignored) {}
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    /** 从目标 URL 拉流并透传到客户端。 */
    private void proxyStream(OutputStream clientOut, String targetUrl, String rangeHeader) throws IOException {
        // 检测域名，用站点特定 headers
        String domain = "";
        try {
            domain = new URL(targetUrl).getHost().toLowerCase(Locale.ROOT);
        } catch (Exception ignored) {}

        HttpURLConnection conn = null;
        InputStream sourceIn = null;
        try {
            URL url = new URL(targetUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod("GET");
            conn.setInstanceFollowRedirects(true);

            // 设置站点特定 headers
            applyHeaders(conn, domain);

            // 转发 Range 请求头（ExoPlayer seek 依赖）
            if (rangeHeader != null && !rangeHeader.isEmpty()) {
                conn.setRequestProperty("Range", rangeHeader);
            }

            int statusCode = conn.getResponseCode();
            // 处理重定向
            if (statusCode >= 300 && statusCode < 400) {
                String location = conn.getHeaderField("Location");
                if (location != null && !location.isEmpty()) {
                    conn.disconnect();
                    // 递归重定向（最多 5 次由 HttpURLConnection 处理）
                    URL redirectUrl = new URL(location);
                    conn = (HttpURLConnection) redirectUrl.openConnection();
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(30000);
                    conn.setRequestMethod("GET");
                    conn.setInstanceFollowRedirects(true);
                    applyHeaders(conn, domain);
                    if (rangeHeader != null && !rangeHeader.isEmpty()) {
                        conn.setRequestProperty("Range", rangeHeader);
                    }
                    statusCode = conn.getResponseCode();
                }
            }

            if (statusCode < 200 || statusCode >= 300) {
                writeError(clientOut, 502, "Upstream returned " + statusCode);
                return;
            }

            String contentType = conn.getContentType();
            long contentLength = conn.getContentLengthLong();

            // 写响应头（保留 206 Partial Content 状态码，传递 Content-Range）
            int responseStatus = statusCode;
            String responseStatusLine = responseStatus == 206 ? "206 Partial Content" : "200 OK";
            StringBuilder response = new StringBuilder();
            response.append("HTTP/1.1 ").append(responseStatusLine).append("\r\n");
            response.append("Connection: close\r\n");
            response.append("Accept-Ranges: bytes\r\n");
            if (contentType != null) {
                response.append("Content-Type: ").append(contentType).append("\r\n");
            }
            if (contentLength > 0) {
                response.append("Content-Length: ").append(contentLength).append("\r\n");
            }
            // 透传 Content-Range（206 响应必需）
            String contentRange = conn.getHeaderField("Content-Range");
            if (contentRange != null) {
                response.append("Content-Range: ").append(contentRange).append("\r\n");
            }
            // DLNA 流式标记
            response.append("transferMode.dlna.org: Streaming\r\n");
            response.append("\r\n");
            clientOut.write(response.toString().getBytes());
            clientOut.flush();

            // 透传流数据
            sourceIn = conn.getInputStream();
            byte[] buffer = new byte[BUFFER_SIZE];
            int bytesRead;
            while ((bytesRead = sourceIn.read(buffer)) != -1) {
                clientOut.write(buffer, 0, bytesRead);
                clientOut.flush();
            }
        } finally {
            if (sourceIn != null) try { sourceIn.close(); } catch (Exception ignored) {}
            if (conn != null) try { conn.disconnect(); } catch (Exception ignored) {}
        }
    }

    /** 根据目标域名应用合适的请求头。 */
    private void applyHeaders(HttpURLConnection conn, String domain) {
        // 通用浏览器 UA
        String ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
        String referer = "";

        if (domain.contains("bilibili") || domain.contains("b23")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 BiliApp/7.28.0 tvproj";
            referer = "https://www.bilibili.com/";
        } else if (domain.contains("iqiyi") || domain.contains("qiyi")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QYPlayer/14.0";
            referer = "https://www.iqiyi.com/";
        } else if (domain.contains("qq") || domain.contains("tencent")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QQLive/9.0";
            referer = "https://v.qq.com/";
        } else if (domain.contains("youku")) {
            referer = "https://www.youku.com/";
        } else if (domain.contains("mgtv")) {
            referer = "https://www.mgtv.com/";
        } else if (domain.contains("sohu")) {
            referer = "https://tv.sohu.com/";
        }

        conn.setRequestProperty("User-Agent", ua);
        if (!referer.isEmpty()) {
            conn.setRequestProperty("Referer", referer);
            conn.setRequestProperty("Origin", referer.substring(0, referer.length() - 1));
        }
    }

    private String extractParam(String path, String name) {
        String prefix = name + "=";
        int idx = path.indexOf('?');
        if (idx < 0) return null;
        String query = path.substring(idx + 1);
        String[] pairs = query.split("&");
        for (String pair : pairs) {
            if (pair.startsWith(prefix)) {
                String value = pair.substring(prefix.length());
                try {
                    return java.net.URLDecoder.decode(value, "UTF-8");
                } catch (Exception e) {
                    return value;
                }
            }
        }
        return null;
    }

    private void writeError(OutputStream out, int code, String message) {
        try {
            String body = "{\"error\":" + code + ",\"message\":\"" + message + "\"}";
            byte[] bodyBytes = body.getBytes("UTF-8");
            String response = "HTTP/1.1 " + code + " " + message + "\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: " + bodyBytes.length + "\r\n" +
                "Connection: close\r\n\r\n";
            out.write(response.getBytes("UTF-8"));
            out.write(bodyBytes);
            out.flush();
        } catch (Exception ignored) {}
    }
}