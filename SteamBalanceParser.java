import java.io.IOException;
import java.math.BigInteger;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * SteamBalanceParser
 *
 * Usage:
 *   java SteamBalanceParser <login> <password> <path_to_mafile> <output_txt>
 */
public class SteamBalanceParser {

    private static final String STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

    public static void main(String[] args) throws Exception {
        if (args.length != 4) {
            System.out.println("Использование: java SteamBalanceParser <login> <password> <path_to_mafile> <output_txt>");
            return;
        }

        String login = args[0];
        String password = args[1];
        Path mafile = Path.of(args[2]);
        Path output = Path.of(args[3]);

        String mafileJson = Files.readString(mafile, StandardCharsets.UTF_8);
        String sharedSecret = jsonString(mafileJson, "shared_secret");
        if (sharedSecret == null || sharedSecret.isBlank()) {
            throw new IllegalArgumentException("В maFile не найден shared_secret");
        }

        CookieManager cookieManager = new CookieManager();
        cookieManager.setCookiePolicy(CookiePolicy.ACCEPT_ALL);

        HttpClient client = HttpClient.newBuilder()
                .cookieHandler(cookieManager)
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();

        String rsaJson = postForm(client,
                "https://steamcommunity.com/login/getrsakey/",
                mapOf(
                        "username", login,
                        "donotcache", String.valueOf(System.currentTimeMillis())
                ));

        String modulusHex = jsonString(rsaJson, "publickey_mod");
        String exponentHex = jsonString(rsaJson, "publickey_exp");
        String rsaTimestamp = jsonString(rsaJson, "timestamp");

        if (modulusHex == null || exponentHex == null || rsaTimestamp == null) {
            throw new IllegalStateException("Не удалось получить RSA-ключ для авторизации. Ответ: " + rsaJson);
        }

        RSAPublicKey publicKey = createRsaPublicKey(modulusHex, exponentHex);
        String encryptedPassword = rsaEncryptBase64(password, publicKey);
        String twoFactorCode = generateSteamGuardCode(sharedSecret, Instant.now().getEpochSecond());

        String loginJson = postForm(client,
                "https://steamcommunity.com/login/dologin/",
                mapOf(
                        "username", login,
                        "password", encryptedPassword,
                        "twofactorcode", twoFactorCode,
                        "emailauth", "",
                        "loginfriendlyname", "steam-balance-parser",
                        "captchagid", "-1",
                        "captcha_text", "",
                        "emailsteamid", "",
                        "rsatimestamp", rsaTimestamp,
                        "remember_login", "true",
                        "donotcache", String.valueOf(System.currentTimeMillis())
                ));

        boolean success = jsonBoolean(loginJson, "success");
        if (!success) {
            String message = jsonString(loginJson, "message");
            if (message == null || message.isBlank()) {
                message = "Неизвестная ошибка логина";
            }
            throw new IllegalStateException("Логин не выполнен: " + message + ". Ответ: " + loginJson);
        }

        Map<String, String> transferParams = jsonObjectStrings(loginJson, "transfer_parameters");
        List<String> transferUrls = jsonStringArray(loginJson, "transfer_urls");

        for (String transferUrl : transferUrls) {
            postForm(client, transferUrl, transferParams);
        }

        String accountHtml = get(client, "https://store.steampowered.com/account/");
        String walletBalance = firstMatch(accountHtml,
                "\\\"wallet_balance\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
        String walletCurrency = firstMatch(accountHtml,
                "\\\"wallet_currency\\\"\\s*:\\s*(\\d+)");

        if (walletBalance == null || walletCurrency == null) {
            throw new IllegalStateException("Не удалось найти баланс/валюту на странице аккаунта.");
        }

        String currencyCode = currencyCodeById(walletCurrency);
        String line = String.format(Locale.ROOT,
                "login=%s; balance=%s; currency_id=%s; currency=%s%n",
                login,
                walletBalance,
                walletCurrency,
                currencyCode);

        Files.writeString(output, line, StandardCharsets.UTF_8);
        System.out.println("Готово. Результат записан в: " + output.toAbsolutePath());
    }

    private static String currencyCodeById(String id) {
        return switch (id) {
            case "1" -> "USD";
            case "2" -> "GBP";
            case "3" -> "EUR";
            case "5" -> "RUB";
            case "7" -> "BRL";
            case "8" -> "JPY";
            case "9" -> "NOK";
            case "10" -> "IDR";
            case "11" -> "MYR";
            case "12" -> "PHP";
            case "13" -> "SGD";
            case "14" -> "THB";
            case "15" -> "VND";
            case "16" -> "KRW";
            case "17" -> "TRY";
            case "18" -> "UAH";
            case "19" -> "MXN";
            case "20" -> "CAD";
            case "21" -> "AUD";
            case "22" -> "NZD";
            case "23" -> "CNY";
            case "24" -> "INR";
            case "25" -> "CLP";
            case "26" -> "PEN";
            case "27" -> "COP";
            case "28" -> "ZAR";
            case "29" -> "HKD";
            case "30" -> "TWD";
            case "31" -> "SAR";
            case "32" -> "AED";
            case "34" -> "PLN";
            case "35" -> "CHF";
            default -> "UNKNOWN";
        };
    }

    private static RSAPublicKey createRsaPublicKey(String modulusHex, String exponentHex) throws GeneralSecurityException {
        BigInteger modulus = new BigInteger(modulusHex, 16);
        BigInteger exponent = new BigInteger(exponentHex, 16);
        RSAPublicKeySpec spec = new RSAPublicKeySpec(modulus, exponent);
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        PublicKey pk = keyFactory.generatePublic(spec);
        return (RSAPublicKey) pk;
    }

    private static String rsaEncryptBase64(String plaintext, RSAPublicKey publicKey) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, publicKey);
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(encrypted);
    }

    private static String generateSteamGuardCode(String sharedSecretB64, long epochSeconds) throws GeneralSecurityException {
        byte[] secret = Base64.getDecoder().decode(sharedSecretB64);
        long timeSlice = epochSeconds / 30L;

        byte[] timeBytes = ByteBuffer.allocate(8).putLong(timeSlice).array();

        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(secret, "HmacSHA1"));
        byte[] hash = mac.doFinal(timeBytes);

        int offset = hash[hash.length - 1] & 0x0F;
        int fullCode = ((hash[offset] & 0x7F) << 24)
                | ((hash[offset + 1] & 0xFF) << 16)
                | ((hash[offset + 2] & 0xFF) << 8)
                | (hash[offset + 3] & 0xFF);

        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            code.append(STEAM_ALPHABET.charAt(fullCode % STEAM_ALPHABET.length()));
            fullCode /= STEAM_ALPHABET.length();
        }
        return code.toString();
    }

    private static String get(HttpClient client, String url) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("User-Agent", "Mozilla/5.0")
                .GET()
                .build();
        HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return resp.body();
    }

    private static String postForm(HttpClient client, String url, Map<String, String> form)
            throws IOException, InterruptedException {
        String formBody = buildForm(form);

        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                .header("User-Agent", "Mozilla/5.0")
                .POST(HttpRequest.BodyPublishers.ofString(formBody, StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return resp.body();
    }

    private static String buildForm(Map<String, String> form) {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> e : form.entrySet()) {
            if (!first) sb.append('&');
            first = false;
            sb.append(urlEncode(e.getKey())).append('=').append(urlEncode(e.getValue()));
        }
        return sb.toString();
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private static String jsonString(String json, String key) {
        return firstMatch(json, "\"" + Pattern.quote(key) + "\"\\s*:\\s*\"([^\"]*)\"");
    }

    private static boolean jsonBoolean(String json, String key) {
        String value = firstMatch(json, "\"" + Pattern.quote(key) + "\"\\s*:\\s*(true|false)");
        return "true".equalsIgnoreCase(value);
    }

    private static List<String> jsonStringArray(String json, String key) {
        String inside = firstMatch(json, "\"" + Pattern.quote(key) + "\"\\s*:\\s*\\[(.*?)]");
        List<String> result = new ArrayList<>();
        if (inside == null) {
            return result;
        }
        Matcher m = Pattern.compile("\"([^\"]*)\"").matcher(inside);
        while (m.find()) {
            result.add(m.group(1));
        }
        return result;
    }

    private static Map<String, String> jsonObjectStrings(String json, String key) {
        String inside = firstMatch(json, "\"" + Pattern.quote(key) + "\"\\s*:\\s*\\{(.*?)}");
        Map<String, String> map = new LinkedHashMap<>();
        if (inside == null) {
            return map;
        }

        Matcher m = Pattern.compile("\"([^\"]+)\"\\s*:\\s*(\"([^\"]*)\"|true|false|-?\\d+)")
                .matcher(inside);

        while (m.find()) {
            String mapKey = m.group(1);
            String rawValue = m.group(2);
            String value;
            if (rawValue.startsWith("\"")) {
                value = m.group(3);
            } else {
                value = rawValue;
            }
            map.put(mapKey, value);
        }
        return map;
    }

    private static String firstMatch(String text, String regex) {
        Matcher matcher = Pattern.compile(regex, Pattern.DOTALL).matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    private static Map<String, String> mapOf(String... kv) {
        if (kv.length % 2 != 0) {
            throw new IllegalArgumentException("mapOf requires even number of arguments");
        }
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            map.put(kv[i], kv[i + 1]);
        }
        return map;
    }
}
