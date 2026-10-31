// Minimal Firebase client over plain HTTPS (no Firebase library needed):
//   - Firebase Auth email/password sign-in + token refresh
//   - Firestore REST: read one document, atomic multi-document commit
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

namespace fs {

// Signs in (or refreshes the token) if needed. Returns false if it couldn't.
bool ensureSignedIn();
// Forget the token so the next call signs in again (after a 401).
void invalidateToken();
bool hasAuthError();  // wrong email/password etc. (not a network problem)

// GET documents/{path}. Returns the HTTP status (200, 404, ... or <0 on network error).
int getDocument(const char* path, JsonDocument& out);

// POST documents:commit with body {"writes":[...]}. Returns the HTTP status.
int commit(JsonDocument& body);

// ------------------------------------------------------------------
// Building writes. Each Write is one document update inside a commit.
// Only fields you set are touched (the update mask is filled for you).
// ------------------------------------------------------------------
enum class Precondition { NONE, MUST_EXIST, MUST_NOT_EXIST };

class Write {
 public:
  Write(JsonArray writes, const char* docPath, Precondition pre = Precondition::NONE);

  void str(const char* key, const char* value);  // nullptr or "" -> null
  void num(const char* key, float value);        // NAN -> null
  void integer(const char* key, long value);
  void boolean(const char* key, bool value);
  void null(const char* key);
  void timestamp(const char* key, time_t epoch);  // 0 -> server time
  void serverTime(const char* key);
  // A map field; fill it with the setValue* helpers below.
  JsonObject map(const char* key);

 private:
  JsonObject fields_;
  JsonArray mask_;
  JsonObject write_;
};

// Value helpers for fields inside a map.
void setString(JsonObject fields, const char* key, const char* value);
void setNumber(JsonObject fields, const char* key, float value);
void setBool(JsonObject fields, const char* key, bool value);

// Reading values out of a GET response ("fields" object).
const char* readString(JsonVariantConst fields, const char* key);  // nullptr if absent/null
double readNumber(JsonVariantConst fields, const char* key, double fallback);
time_t readTimestamp(JsonVariantConst fields, const char* key);    // 0 if absent
JsonVariantConst readMap(JsonVariantConst fields, const char* key);  // the map's "fields"

}  // namespace fs
