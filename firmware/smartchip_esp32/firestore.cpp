#include "firestore.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "config.h"
#include "secrets_include.h"

namespace fs {

static String idToken;
static String refreshToken;
static uint32_t tokenExpiresAtMs = 0;
static bool authError = false;

static const char* AUTH_URL =
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" FIREBASE_API_KEY;
static const char* REFRESH_URL = "https://securetoken.googleapis.com/v1/token?key=" FIREBASE_API_KEY;
static const char* DOCS_URL =
    "https://firestore.googleapis.com/v1/projects/" FIREBASE_PROJECT_ID "/databases/(default)/documents";
static const char* DOC_NAME_PREFIX = "projects/" FIREBASE_PROJECT_ID "/databases/(default)/documents/";

// One HTTPS request. Returns the status code (<0 = network error) and the body.
static int request(const char* method, const String& url, const String& body, const char* contentType,
                   bool withAuth, String& response) {
  WiFiClientSecure client;
#if TLS_VERIFY
  client.useBuiltinCACertBundle();
#else
  client.setInsecure();
#endif
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) return -1;
  if (contentType) http.addHeader("Content-Type", contentType);
  if (withAuth) http.addHeader("Authorization", "Bearer " + idToken);

  int code = strcmp(method, "GET") == 0 ? http.GET() : http.POST(body);
  response = code > 0 ? http.getString() : String();
  http.end();
  return code;
}

static bool storeTokens(JsonDocument& doc, const char* idKey, const char* refreshKey, const char* expiresKey) {
  const char* id = doc[idKey];
  const char* refresh = doc[refreshKey];
  if (!id || !refresh) return false;
  idToken = id;
  refreshToken = refresh;
  long expires = atol(doc[expiresKey] | "3600");
  // Refresh 5 minutes early.
  tokenExpiresAtMs = millis() + (uint32_t)max(60L, expires - 300) * 1000UL;
  return true;
}

static bool signIn() {
  JsonDocument req;
  req["email"] = DEVICE_EMAIL;
  req["password"] = DEVICE_PASSWORD;
  req["returnSecureToken"] = true;
  String body, response;
  serializeJson(req, body);

  int code = request("POST", AUTH_URL, body, "application/json", false, response);
  if (code != 200) {
    Serial.printf("[auth] sign-in failed (%d): %s\n", code, response.substring(0, 200).c_str());
    // 400 = wrong email/password/API key: retrying quickly won't help.
    authError = code == 400;
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, response) || !storeTokens(doc, "idToken", "refreshToken", "expiresIn")) return false;
  authError = false;
  Serial.printf("[auth] signed in as %s (uid %s)\n", DEVICE_EMAIL, (const char*)(doc["localId"] | "?"));
  return true;
}

static bool refresh() {
  String response;
  String body = "grant_type=refresh_token&refresh_token=" + refreshToken;
  int code = request("POST", REFRESH_URL, body, "application/x-www-form-urlencoded", false, response);
  if (code != 200) {
    Serial.printf("[auth] token refresh failed (%d)\n", code);
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, response)) return false;
  return storeTokens(doc, "id_token", "refresh_token", "expires_in");
}

bool ensureSignedIn() {
  if (idToken.length() && (int32_t)(tokenExpiresAtMs - millis()) > 0) return true;
  if (refreshToken.length() && refresh()) return true;
  return signIn();
}

void invalidateToken() {
  idToken = "";
  tokenExpiresAtMs = 0;
}

bool hasAuthError() { return authError; }

int getDocument(const char* path, JsonDocument& out) {
  String response;
  String url = String(DOCS_URL) + "/" + path;
  int code = request("GET", url, "", nullptr, true, response);
  if (code == 401) invalidateToken();
  if (code == 200) {
    DeserializationError err = deserializeJson(out, response);
    if (err) {
      Serial.printf("[firestore] bad JSON: %s\n", err.c_str());
      return -2;
    }
  }
  return code;
}

int commit(JsonDocument& body) {
  String payload, response;
  serializeJson(body, payload);
  String url = String(DOCS_URL) + ":commit";
  int code = request("POST", url, payload, "application/json", true, response);
  if (code == 401) invalidateToken();
  if (code != 200) {
    Serial.printf("[firestore] commit failed (%d): %s\n", code, response.substring(0, 300).c_str());
  }
  return code;
}

// ------------------------------------------------------------------
// Value encoding (Firestore REST "Value" objects)
// ------------------------------------------------------------------

static void formatTimestamp(char* out, size_t n, time_t epoch) {
  struct tm t;
  gmtime_r(&epoch, &t);
  strftime(out, n, "%Y-%m-%dT%H:%M:%SZ", &t);
}

void setString(JsonObject fields, const char* key, const char* value) {
  JsonObject v = fields[key].to<JsonObject>();
  if (value && value[0]) v["stringValue"] = value;
  else v["nullValue"] = nullptr;
}

void setNumber(JsonObject fields, const char* key, float value) {
  JsonObject v = fields[key].to<JsonObject>();
  if (isnan(value)) v["nullValue"] = nullptr;
  else v["doubleValue"] = roundf(value * 100.0f) / 100.0f;
}

void setBool(JsonObject fields, const char* key, bool value) { fields[key].to<JsonObject>()["booleanValue"] = value; }

Write::Write(JsonArray writes, const char* docPath, Precondition pre) {
  write_ = writes.add<JsonObject>();
  JsonObject update = write_["update"].to<JsonObject>();
  update["name"] = String(DOC_NAME_PREFIX) + docPath;
  fields_ = update["fields"].to<JsonObject>();
  mask_ = write_["updateMask"]["fieldPaths"].to<JsonArray>();
  if (pre == Precondition::MUST_EXIST) write_["currentDocument"]["exists"] = true;
  if (pre == Precondition::MUST_NOT_EXIST) write_["currentDocument"]["exists"] = false;
}

void Write::str(const char* key, const char* value) {
  setString(fields_, key, value);
  mask_.add(key);
}

void Write::num(const char* key, float value) {
  setNumber(fields_, key, value);
  mask_.add(key);
}

void Write::integer(const char* key, long value) {
  // Firestore REST sends 64-bit integers as strings.
  fields_[key]["integerValue"] = String(value);
  mask_.add(key);
}

void Write::boolean(const char* key, bool value) {
  setBool(fields_, key, value);
  mask_.add(key);
}

void Write::null(const char* key) {
  fields_[key]["nullValue"] = nullptr;
  mask_.add(key);
}

void Write::timestamp(const char* key, time_t epoch) {
  if (epoch <= 0) {
    serverTime(key);
    return;
  }
  char iso[32];
  formatTimestamp(iso, sizeof(iso), epoch);
  fields_[key]["timestampValue"] = iso;
  mask_.add(key);
}

void Write::serverTime(const char* key) {
  // Transforms are applied after the update; the field must not be in the mask.
  JsonArray transforms = write_["updateTransforms"].is<JsonArray>() ? write_["updateTransforms"].as<JsonArray>()
                                                                    : write_["updateTransforms"].to<JsonArray>();
  JsonObject t = transforms.add<JsonObject>();
  t["fieldPath"] = key;
  t["setToServerValue"] = "REQUEST_TIME";
}

JsonObject Write::map(const char* key) {
  mask_.add(key);
  return fields_[key]["mapValue"]["fields"].to<JsonObject>();
}

// ------------------------------------------------------------------
// Reading values
// ------------------------------------------------------------------

const char* readString(JsonVariantConst fields, const char* key) { return fields[key]["stringValue"]; }

double readNumber(JsonVariantConst fields, const char* key, double fallback) {
  JsonVariantConst v = fields[key];
  if (v["doubleValue"].is<double>()) return v["doubleValue"].as<double>();
  if (v["integerValue"].is<const char*>()) return atof(v["integerValue"].as<const char*>());
  if (v["integerValue"].is<long>()) return v["integerValue"].as<long>();
  return fallback;
}

// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
static long daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long)doe - 719468;
}

time_t readTimestamp(JsonVariantConst fields, const char* key) {
  const char* iso = fields[key]["timestampValue"];
  if (!iso) return 0;
  int y, mo, d, h, mi, s;
  if (sscanf(iso, "%4d-%2d-%2dT%2d:%2d:%2d", &y, &mo, &d, &h, &mi, &s) != 6) return 0;
  return (time_t)(daysFromCivil(y, mo, d) * 86400L + h * 3600L + mi * 60L + s);
}

JsonVariantConst readMap(JsonVariantConst fields, const char* key) { return fields[key]["mapValue"]["fields"]; }

}  // namespace fs
