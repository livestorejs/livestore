// This file should be included in the build with --post-js.

;(function () {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

  /**
   * Apply a changeset to the "main" database, relaying filter and conflict
   * callbacks to JavaScript through the C adapter layer via method dispatch.
   *
   * @param {number} db - Database handle pointer.
   * @param {number} nChangeset - Size of changeset in bytes.
   * @param {number} pChangeset - Pointer to changeset blob in WASM memory.
   * @param {function(string): number | null} xFilter - Optional filter callback.
   *   Called with the table name for each table in the changeset. Return 0 to
   *   skip changes for that table, non-zero to include them. Pass null to
   *   include all tables.
   * @param {function(number): number} xConflict - Conflict handler called with
   *   the conflict type (SQLITE_CHANGESET_DATA, _NOTFOUND, _CONFLICT,
   *   _CONSTRAINT, or _FOREIGN_KEY). Must return SQLITE_CHANGESET_OMIT (0),
   *   SQLITE_CHANGESET_REPLACE (1), or SQLITE_CHANGESET_ABORT (2).
   *   See https://sqlite.org/session/sqlite3changeset_apply.html
   * @returns {number} SQLITE_OK on success, or an SQLite error code.
   *
   * @see https://sqlite.org/session/sqlite3changeset_apply.html
   */
  Module['changeset_apply'] = function (db, nChangeset, pChangeset, xFilter, xConflict) {
    const pAsyncFlags = Module['_sqlite3_malloc'](4)
    let asyncFlags = 0
    if (xFilter && xFilter instanceof AsyncFunction) asyncFlags |= (1 << 0)
    if (xConflict instanceof AsyncFunction) asyncFlags |= (1 << 1)
    setValue(pAsyncFlags, asyncFlags, 'i32')

    const target = {}
    if (xFilter) {
      target.xFilter = (zTab) => xFilter(Module['UTF8ToString'](zTab))
    }
    target.xConflict = (eConflict, _pIter) => xConflict(eConflict)

    Module['setCallback'](pAsyncFlags, target)

    const result = ccall(
      'libsession_changeset_apply', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number'],
      [db, nChangeset, pChangeset, xFilter ? 1 : 0, 1, pAsyncFlags]
    )

    Module['deleteCallback'](pAsyncFlags)
    Module['_sqlite3_free'](pAsyncFlags)

    return result
  }
})()
