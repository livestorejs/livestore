#include <stdio.h>
#include <emscripten.h>
#include <sqlite3.h>

#include "libadapters.h"

enum {
  xFilter,
  xConflict,
};

#define SESSION_JS(SIGNATURE, KEY, METHOD, ...) \
  (asyncFlags & (1 << METHOD) ? \
    SIGNATURE##_async(KEY, #METHOD, __VA_ARGS__) : \
    SIGNATURE(KEY, #METHOD, __VA_ARGS__))

/*
** Filter callback that relays to a JavaScript function via method
** dispatch. Returns non-zero to include changes for the table,
** or zero to exclude them.
**
** See https://sqlite.org/session/sqlite3changeset_apply.html
*/
static int libsession_xFilter(void* pCtx, const char* zTab) {
  const int asyncFlags = pCtx ? *(int *)pCtx : 0;
  return SESSION_JS(ippp, pCtx, xFilter, zTab);
}

/*
** Conflict handler callback that relays to a JavaScript function
** via method dispatch.
**
** See https://sqlite.org/session/sqlite3changeset_apply.html
*/
static int libsession_xConflict(void* pCtx, int eConflict, sqlite3_changeset_iter* p) {
  const int asyncFlags = pCtx ? *(int *)pCtx : 0;
  return SESSION_JS(ippip, pCtx, xConflict, eConflict, p);
}

/*
** Apply the changeset (pChangeset, nChangeset) to the "main" database
** of handle db. Both xFilter and xConflict are resolved through the
** adapter relay via method dispatch on the target object stored at
** key pCtx.
**
** Return SQLITE_OK on success, or an SQLite error code on failure.
*/
int EMSCRIPTEN_KEEPALIVE libsession_changeset_apply(
  sqlite3* db,                  /* Database handle */
  int nChangeset,               /* Size of changeset in bytes */
  void* pChangeset,             /* Pointer to changeset blob */
  int hasXFilter,               /* Non-zero if a filter callback is registered */
  int hasXConflict,             /* Non-zero if a conflict handler is registered */
  void* pCtx) {                 /* Callback lookup key */
  return sqlite3changeset_apply(
    db, nChangeset, pChangeset,
    hasXFilter ? &libsession_xFilter : NULL,
    hasXConflict ? &libsession_xConflict : NULL,
    pCtx);
}
