// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.

import * as SQLite from './sqlite-constants.js';
export * from './sqlite-constants.js';

const MAX_INT64 = 0x7fffffffffffffffn;
const MIN_INT64 = -0x8000000000000000n;

// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export class SQLiteError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// const async = true;
const async = false;

/**
 * Builds a Javascript API from the Emscripten module. This API is still
 * low-level and closely corresponds to the C API exported by the module,
 * but differs in some specifics like throwing exceptions on errors.
 * @param {*} Module SQLite Emscripten module
 * @returns {SQLiteAPI}
 */
export function Factory(Module) {
  /** @type {SQLiteAPI} */ const sqlite3 = {};

  Module.retryOps = [];
  const sqliteFreeAddress = Module._getSqliteFree();

  // Allocate some space for 32-bit returned values.
  const tmp = Module._malloc(8);
  const tmpPtr = [tmp, tmp + 4];

  const textEncoder = new TextEncoder();
  // Convert a JS string to a C string. sqlite3_malloc is used to allocate
  // memory (use sqlite3_free to deallocate).
  function createUTF8(s) {
    if (typeof s !== 'string') return 0;
    const utf8 = textEncoder.encode(s);
    const zts = Module._sqlite3_malloc(utf8.byteLength + 1);
    Module.HEAPU8.set(utf8, zts);
    Module.HEAPU8[zts + utf8.byteLength] = 0;
    return zts;
  }

  /**
   * Concatenate 32-bit numbers into a 64-bit (signed) BigInt.
   * @param {number} lo32
   * @param {number} hi32
   * @returns {bigint}
   */
  function cvt32x2ToBigInt(lo32, hi32) {
    return (BigInt(hi32) << 32n) | (BigInt(lo32) & 0xffffffffn);
  }

  /**
   * Concatenate 32-bit numbers and return as number or BigInt, depending
   * on the value.
   * @param {number} lo32 
   * @param {number} hi32 
   * @returns {number|bigint}
   */
  const cvt32x2AsSafe = (function() {
    const hiMax = BigInt(Number.MAX_SAFE_INTEGER) >> 32n;
    const hiMin = BigInt(Number.MIN_SAFE_INTEGER) >> 32n;

    return function(lo32, hi32) {
      if (hi32 > hiMax || hi32 < hiMin) {
        // Can't be expressed as a Number so use BigInt.
        return cvt32x2ToBigInt(lo32, hi32);
      } else {
        // Combine the upper and lower 32-bit numbers. The complication is
        // that lo32 is a signed integer which makes manipulating its bits
        // a little tricky - the sign bit gets handled separately.
        return (hi32 * 0x100000000) + (lo32 & 0x7fffffff) - (lo32 & 0x80000000);
      }
    }
  })();

  const databases = new Set();
  function verifyDatabase(db) {
    if (!databases.has(db)) {
      throw new SQLiteError('not a database', SQLite.SQLITE_MISUSE);
    }
  }

  const mapStmtToDB = new Map();
  function verifyStatement(stmt) {
    if (!mapStmtToDB.has(stmt)) {
      throw new SQLiteError('not a statement', SQLite.SQLITE_MISUSE);
    }
  }

  sqlite3.bind_collection = function(stmt, bindings) {
    verifyStatement(stmt);
    const isArray = Array.isArray(bindings);
    const nBindings = sqlite3.bind_parameter_count(stmt);
    for (let i = 1; i <= nBindings; ++i) {
      const key = isArray ? i - 1 : sqlite3.bind_parameter_name(stmt, i);
      const value = bindings[key];
      if (value !== undefined) {
        sqlite3.bind(stmt, i, value);
      }
    }
    return SQLite.SQLITE_OK;
  };

  sqlite3.bind = function(stmt, i, value) {
    verifyStatement(stmt);
    switch (typeof value) {
      case 'number':
        if (value === (value | 0)) {
          return sqlite3.bind_int(stmt, i, value);
        } else {
          return sqlite3.bind_double(stmt, i, value);
        }
      case 'string':
        return sqlite3.bind_text(stmt, i, value);
      case "boolean":
        return sqlite3.bind_int(stmt, i, value ? 1 : 0);
      default:
        if (value instanceof Uint8Array || Array.isArray(value)) {
          return sqlite3.bind_blob(stmt, i, value);
        } else if (value === null) {
          return sqlite3.bind_null(stmt, i);
        } else if (typeof value === 'bigint') {
          return sqlite3.bind_int64(stmt, i, value);
        } else if (value === undefined) {
          // Existing binding (or NULL) will be used.
          return SQLite.SQLITE_NOTICE;
        } else {
          console.warn('unknown binding converted to null', value);
          return sqlite3.bind_null(stmt, i);
        }
    }
  };

  sqlite3.bind_blob = (function() {
    const fname = 'sqlite3_bind_blob';
    const f = Module.cwrap(fname, ...decl('nnnnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      // @ts-ignore
      const byteLength = value.byteLength ?? value.length;
      const ptr = Module._sqlite3_malloc(byteLength);
      Module.HEAPU8.subarray(ptr).set(value);
      const result = f(stmt, i, ptr, byteLength, sqliteFreeAddress);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.bind_parameter_count = (function() {
    const fname = 'sqlite3_bind_parameter_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return result;
    };
  })();

  sqlite3.bind_double = (function() {
    const fname = 'sqlite3_bind_double';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      const result = f(stmt, i, value);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.bind_int = (function() {
    const fname = 'sqlite3_bind_int';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      if (value > 0x7fffffff || value < -0x80000000) return SQLite.SQLITE_RANGE;

      const result = f(stmt, i, value);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.bind_int64 = (function() {
    const fname = 'sqlite3_bind_int64';
    const f = Module.cwrap(fname, ...decl('nnnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      if (value > MAX_INT64 || value < MIN_INT64) return SQLite.SQLITE_RANGE;

      const lo32 = value & 0xffffffffn;
      const hi32 = value >> 32n;
      const result = f(stmt, i, Number(lo32), Number(hi32));
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.bind_null = (function() {
    const fname = 'sqlite3_bind_null';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, i) {
      verifyStatement(stmt);
      const result = f(stmt, i);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.bind_parameter_name = (function() {
    const fname = 'sqlite3_bind_parameter_name';
    const f = Module.cwrap(fname, ...decl('n:s'));
    return function(stmt, i) {
      verifyStatement(stmt);
      const result = f(stmt, i);
      return result;
    };
  })();

  sqlite3.bind_text = (function() {
    const fname = 'sqlite3_bind_text';
    const f = Module.cwrap(fname, ...decl('nnnnn:n'));
    return function(stmt, i, value) {
      verifyStatement(stmt);
      const ptr = createUTF8(value);
      const result = f(stmt, i, ptr, -1, sqliteFreeAddress);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.changes = (function() {
    const fname = 'sqlite3_changes';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(db) {
      verifyDatabase(db);
      const result = f(db);
      return result;
    };
  })();

  sqlite3.deserialize = (function() {
    const fname = 'sqlite3_deserialize';
    const f = Module.cwrap(fname, ...decl('nnnnnn:n'));
    return function(db, schema, data, szDb, szBuf, flags) {
      verifyDatabase(db);
      const ptr = Module._sqlite3_malloc(szDb);
      Module.HEAPU8.subarray(ptr).set(data);
      const result = f(db, schema, ptr, szDb, szBuf, flags);
      return result;
    };
  })();

  const SQLITE_SERIALIZE_NOCOPY = 0x0_01

  sqlite3.serialize = (function() {
    const fname = 'sqlite3_serialize';
    const f = Module.cwrap(fname, ...decl('nsnn:n'));
    return function(db, schema) {
      verifyDatabase(db);
      const piSize = tmpPtr[0];
      let address = f(db, schema, piSize, 0); // 0 means no flags
      if (address === 0) {
        address = f(db, schema, piSize, SQLITE_SERIALIZE_NOCOPY);
        const size = Module.getValue(piSize, '*');
        const result = Module.HEAPU8.subarray(address, address + size);
        // NOTE Given that the memory is owned by SQLite, we must copy it.
        // Warning: We're not super confident yet about this code path. There might be dragons.
        return new Uint8Array(result.slice());
      } else {
        const size = Module.getValue(piSize, '*');
        const result = Module.HEAPU8.subarray(address, address + size);
        // Copy the data immediately, then free the SQLite buffer to prevent ref-count issues
        const copy = new Uint8Array(result);
        Module._sqlite3_free(address); 
        return copy;
      }
    };
  })();

  // https://www.sqlite.org/c3ref/backup_finish.html
  // https://www.sqlite.org/backup.html
  sqlite3.backup = (function() {
    const fInit = Module.cwrap('sqlite3_backup_init', ...decl('nsns:n'));
    const fStep = Module.cwrap('sqlite3_backup_step', ...decl('nn:n'));
    const fFinish = Module.cwrap('sqlite3_backup_finish', ...decl('n:n'));
    return function(dest, destName, source, sourceName) {
      verifyDatabase(dest);
      verifyDatabase(source);
      const backup = fInit(dest, destName, source, sourceName);
      if (backup === 0) {
        const errMsg = Module.ccall('sqlite3_errmsg', 'string', ['number'], [dest]);
        throw new SQLiteError(`backup failed: ${errMsg}`, SQLite.SQLITE_ERROR);
      }
      // TODO also allow run in chunks with some yielding mechanism
      fStep(backup, -1); // -1 means do it in one go
      return fFinish(backup);
    };
  })();
  

  // TODO implement this at some point
  // sqlite3.backup_step = (function() {

  sqlite3.clear_bindings = (function() {
    const fname = 'sqlite3_clear_bindings';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();
  
  sqlite3.close = (function() {
    const fname = 'sqlite3_close';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    // return async function(db) {
    return function(db) {
      verifyDatabase(db);
      // const result = await f(db);
      const result = f(db);
      databases.delete(db);
      return check(fname, result, db);
    };
  })();

  sqlite3.column = function(stmt, iCol) {
    verifyStatement(stmt);
    const type = sqlite3.column_type(stmt, iCol);
    switch (type) {
      case SQLite.SQLITE_BLOB:
        return sqlite3.column_blob(stmt, iCol);
      case SQLite.SQLITE_FLOAT:
        return sqlite3.column_double(stmt, iCol);
      case SQLite.SQLITE_INTEGER:
        const lo32 = sqlite3.column_int(stmt, iCol);
        const hi32 = Module.getTempRet0();
        return cvt32x2AsSafe(lo32, hi32);
      case SQLite.SQLITE_NULL:
        return null;
      case SQLite.SQLITE_TEXT:
        return sqlite3.column_text(stmt, iCol);
      default:
        throw new SQLiteError('unknown type', type);
    }
  };

  sqlite3.column_blob = (function() {
    const fname = 'sqlite3_column_blob';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const nBytes = sqlite3.column_bytes(stmt, iCol);
      const address = f(stmt, iCol);
      if (address === 0) {
        return null; // Handle NULL BLOBs
      }
      const result = Module.HEAPU8.subarray(address, address + nBytes);
      return new Uint8Array(result); // Ensure a copy is returned
    };
  })();

  sqlite3.column_bytes = (function() {
    const fname = 'sqlite3_column_bytes';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      return result;
    };
  })();

  sqlite3.column_count = (function() {
    const fname = 'sqlite3_column_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return result;
    };
  })();

  sqlite3.column_double = (function() {
    const fname = 'sqlite3_column_double';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      return result;
    };
  })();

  sqlite3.column_int = (function() {
    // Retrieve int64 but use only the lower 32 bits. The upper 32-bits are
    // accessible with Module.getTempRet0().
    const fname = 'sqlite3_column_int64';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      return result;
    };
  })();

  sqlite3.column_int64 = (function() {
    const fname = 'sqlite3_column_int64';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const lo32 = f(stmt, iCol);
      const hi32 = Module.getTempRet0();
      const result = cvt32x2ToBigInt(lo32, hi32);
      return result;
    };
  })();

  sqlite3.column_name = (function() {
    const fname = 'sqlite3_column_name';
    const f = Module.cwrap(fname, ...decl('nn:s'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      return result;
    };
  })();

  sqlite3.column_names = function(stmt) {
    const columns = [];
    const nColumns = sqlite3.column_count(stmt);
    for (let i = 0; i < nColumns; ++i) {
      columns.push(sqlite3.column_name(stmt, i));
    }
    return columns;
  };

  sqlite3.column_text = (function() {
    const fname = 'sqlite3_column_text';
    const f = Module.cwrap(fname, ...decl('nn:s'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      return result;
    };
  })();

  sqlite3.column_type = (function() {
    const fname = 'sqlite3_column_type';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(stmt, iCol) {
      verifyStatement(stmt);
      const result = f(stmt, iCol);
      return result;
    };
  })();

  sqlite3.create_function = function(db, zFunctionName, nArg, eTextRep, pApp, xFunc, xStep, xFinal) {
    verifyDatabase(db);
    
    // Convert SQLite callback arguments to JavaScript-friendly arguments.
    function adapt(f) {
      // return f instanceof AsyncFunction ?
      //   (async (ctx, n, values) => f(ctx, Module.HEAP32.subarray(values / 4, values / 4 + n))) :
      //   ((ctx, n, values) => f(ctx, Module.HEAP32.subarray(values / 4, values / 4 + n)));
      return ((ctx, n, values) => f(ctx, Module.HEAP32.subarray(values / 4, values / 4 + n)));
    }

    const result = Module.create_function(
      db,
      zFunctionName,
      nArg,
      eTextRep,
      pApp,
      xFunc && adapt(xFunc),
      xStep && adapt(xStep),
      xFinal);
    return check('sqlite3_create_function', result, db);
  };

  sqlite3.data_count = (function() {
    const fname = 'sqlite3_data_count';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return result;
    };
  })();

  // sqlite3.exec = async function(db, sql, callback) {
  //   for await (const stmt of sqlite3.statements(db, sql)) {
  //     let columns;
  //     while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
  //       if (callback) {
  //         columns = columns ?? sqlite3.column_names(stmt);
  //         const row = sqlite3.row(stmt);
  //         await callback(row, columns);
  //       }
  //     }
  //   }
  //   return SQLite.SQLITE_OK;
  // };
  sqlite3.exec = function(db, sql, callback) {
    const stmts = sqlite3.statements(db, sql, { unscoped: true });
    for (const stmt of stmts) {
      let columns;
      while (sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
        if (callback) {
          columns = columns ?? sqlite3.column_names(stmt);
          const row = sqlite3.row(stmt);
          callback(row, columns);
        }
      }
    }
    for (const stmt of stmts) {
      sqlite3.finalize(stmt);
    }
    return SQLite.SQLITE_OK;
  };

  sqlite3.finalize = (function() {
    const fname = 'sqlite3_finalize';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    // return async function(stmt) {
    //   const result = await f(stmt);
    return function(stmt) {
      const result = f(stmt);
      mapStmtToDB.delete(stmt)

      // Don't throw on error here. Typically the error has already been
      // thrown and finalize() is part of the cleanup.
      return result;
    };
  })();

  sqlite3.get_autocommit = (function() {
    const fname = 'sqlite3_get_autocommit';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(db) {
      const result = f(db);
      return result;
    };
  })();

  sqlite3.libversion = (function() {
    const fname = 'sqlite3_libversion';
    const f = Module.cwrap(fname, ...decl(':s'));
    return function() {
      const result = f();
      return result;
    };
  })();

  sqlite3.libversion_number = (function() {
    const fname = 'sqlite3_libversion_number';
    const f = Module.cwrap(fname, ...decl(':n'));
    return function() {
      const result = f();
      return result;
    };
  })();

  sqlite3.limit = (function() {
    const fname = 'sqlite3_limit';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(db, id, newVal) {
      const result = f(db, id, newVal);
      return result;
    };
  })();

  sqlite3.open_v2 = (function() {
    const fname = 'sqlite3_open_v2';
    const f = Module.cwrap(fname, ...decl('snnn:n'), { async });
    return async function(zFilename, flags, zVfs) {
      flags = flags || SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE;
      zVfs = createUTF8(zVfs);
      try {
        // Allow retry operations.
        const rc = await retry(() => f(zFilename, tmpPtr[0], flags, zVfs));

        const db = Module.getValue(tmpPtr[0], '*');
        databases.add(db);

        Module.ccall('RegisterExtensionFunctions', 'void', ['number'], [db]);
        check(fname, rc, db);
        return db;
      } finally {
        Module._sqlite3_free(zVfs);
      }
    };
  })();

  sqlite3.open_v2Sync = (function() {
    const fname = 'sqlite3_open_v2';
    const f = Module.cwrap(fname, ...decl('snnn:n'), { async });
    return function(zFilename, flags, zVfs) {
      flags = flags || SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE;
      zVfs = createUTF8(zVfs);
      try {
        // Allow retry operations.
        // const rc = await retry(() => f(zFilename, tmpPtr[0], flags, zVfs));
        const rc = f(zFilename, tmpPtr[0], flags, zVfs);

        const db = Module.getValue(tmpPtr[0], '*');
        databases.add(db);

        Module.ccall('RegisterExtensionFunctions', 'void', ['number'], [db]);
        check(fname, rc, db);
        return db;
      } finally {
        Module._sqlite3_free(zVfs);
      }
    };
  })();


  sqlite3.progress_handler = function(db, nProgressOps, handler, userData) {
    verifyDatabase(db);
    Module.progress_handler(db, nProgressOps, handler, userData);
  };;

  sqlite3.reset = (function() {
    const fname = 'sqlite3_reset';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return check(fname, result, mapStmtToDB.get(stmt));
    };
  })();

  sqlite3.result = function(context, value) {
    switch (typeof value) {
      case 'number':
        if (value === (value | 0)) {
          sqlite3.result_int(context, value);
        } else {
          sqlite3.result_double(context, value);
        }
        break;
      case 'string':
        sqlite3.result_text(context, value);
        break;
      default:
        if (value instanceof Uint8Array || Array.isArray(value)) {
          sqlite3.result_blob(context, value);
        } else if (value === null) {
          sqlite3.result_null(context);
        } else if (typeof value === 'bigint') {
          return sqlite3.result_int64(context, value);
        } else {
          console.warn('unknown result converted to null', value);
          sqlite3.result_null(context);
        }
        break;
    }

  };

  sqlite3.result_blob = (function() {
    const fname = 'sqlite3_result_blob';
    const f = Module.cwrap(fname, ...decl('nnnn:n'));
    return function(context, value) {
      // @ts-ignore
      const byteLength = value.byteLength ?? value.length;
      const ptr = Module._sqlite3_malloc(byteLength);
      Module.HEAPU8.subarray(ptr).set(value);
      f(context, ptr, byteLength, sqliteFreeAddress); // void return
    };
  })();

  sqlite3.result_double = (function() {
    const fname = 'sqlite3_result_double';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(context, value) {
      f(context, value); // void return
    };
  })();

  sqlite3.result_int = (function() {
    const fname = 'sqlite3_result_int';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(context, value) {
      f(context, value); // void return
    };
  })();

  sqlite3.result_int64 = (function() {
    const fname = 'sqlite3_result_int64';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(context, value) {
      if (value > MAX_INT64 || value < MIN_INT64) return SQLite.SQLITE_RANGE;

      const lo32 = value & 0xffffffffn;
      const hi32 = value >> 32n;
      f(context, Number(lo32), Number(hi32)); // void return
    };
  })();

  sqlite3.result_null = (function() {
    const fname = 'sqlite3_result_null';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(context) {
      f(context); // void return
    };
  })();

  sqlite3.result_text = (function() {
    const fname = 'sqlite3_result_text';
    const f = Module.cwrap(fname, ...decl('nnnn:n'));
    return function(context, value) {
      const ptr = createUTF8(value);
      f(context, ptr, -1, sqliteFreeAddress); // void return
    };
  })();

  sqlite3.row = function(stmt) {
    const row = [];
    const nColumns = sqlite3.data_count(stmt);
    for (let i = 0; i < nColumns; ++i) {
      const value = sqlite3.column(stmt, i);

      // Copy blob if aliasing volatile WebAssembly memory. This avoids an
      // unnecessary copy if users monkey patch column_blob to copy.
      // @ts-ignore
      row.push(value?.buffer === Module.HEAPU8.buffer ? value.slice() : value);
    }
    return row;
  };

  sqlite3.set_authorizer = function(db, xAuth, pApp) {
    verifyDatabase(db);

    // Convert SQLite callback arguments to JavaScript-friendly arguments.
    function cvtArgs(_, iAction, p3, p4, p5, p6) {
      return [
        _,
        iAction,
        Module.UTF8ToString(p3),
        Module.UTF8ToString(p4),
        Module.UTF8ToString(p5),
        Module.UTF8ToString(p6)
      ];
    };
    function adapt(f) {
      // return f instanceof AsyncFunction ?
      //   (async (_, iAction, p3, p4, p5, p6) => f(...cvtArgs(_, iAction, p3, p4, p5, p6))) :
      //   ((_, iAction, p3, p4, p5, p6) => f(...cvtArgs(_, iAction, p3, p4, p5, p6)));
      return ((_, iAction, p3, p4, p5, p6) => f(...cvtArgs(_, iAction, p3, p4, p5, p6)));
    }

    const result = Module.set_authorizer(db, adapt(xAuth), pApp);
    return check('sqlite3_set_authorizer', result, db);
  };;
  
  sqlite3.sql = (function() {
    const fname = 'sqlite3_sql';
    const f = Module.cwrap(fname, ...decl('n:s'));
    return function(stmt) {
      verifyStatement(stmt);
      const result = f(stmt);
      return result;
    };
  })();

  sqlite3.statements = function(db, sql, options = {}) {
    const prepare = Module.cwrap(
      'sqlite3_prepare_v3',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number'],
      // { async: true });
      { async: false });

      const stmts = [];

      // return (async function*() {
      const onFinally = [];
      // try {
        // Encode SQL string to UTF-8.
        const utf8 = textEncoder.encode(sql);

        // Copy encoded string to WebAssembly memory. The SQLite docs say
        // zero-termination is a minor optimization so add room for that.
        // Also add space for the statement handle and SQL tail pointer.
        const allocSize = utf8.byteLength - (utf8.byteLength % 4) + 12;
        const pzHead = Module._sqlite3_malloc(allocSize);
        const pzEnd = pzHead + utf8.byteLength + 1;
        onFinally.push(() => Module._sqlite3_free(pzHead));
        Module.HEAPU8.set(utf8, pzHead);
        Module.HEAPU8[pzEnd - 1] = 0;
  
        // Use extra space for the statement handle and SQL tail pointer.
        const pStmt = pzHead + allocSize - 8;
        const pzTail = pzHead + allocSize - 4;

        // Ensure that statement handles are not leaked.
        let stmt;
        function maybeFinalize() {
          if (stmt && !options.unscoped) {
            sqlite3.finalize(stmt);
          }
          stmt = 0;
        }
        onFinally.push(maybeFinalize);
        
        // Loop over statements.
        Module.setValue(pzTail, pzHead, '*');
        do {
          // Reclaim resources for the previous iteration.
          maybeFinalize();

          // Call sqlite3_prepare_v3() for the next statement.
          // Allow retry operations.
          const zTail = Module.getValue(pzTail, '*');
          const rc = prepare(
            db,
            zTail,
            pzEnd - pzTail,
            options.flags || 0,
            pStmt,
            pzTail);

          if (rc !== SQLite.SQLITE_OK) {
            check('sqlite3_prepare_v3', rc, db);
          }
          
          stmt = Module.getValue(pStmt, '*');
          if (stmt) {
            mapStmtToDB.set(stmt, db);
            // yield stmt;
            stmts.push(stmt);
          }
        } while (stmt);
      // } finally {
      //   while (onFinally.length) {
      //     onFinally.pop()();
      //   }
      // }

      return stmts;
  };

  sqlite3.step = (function() {
    const fname = 'sqlite3_step';
    const f = Module.cwrap(fname, ...decl('n:n'), { async });
    // return async function(stmt) {
    return function(stmt) {
      verifyStatement(stmt);

      // Allow retry operations.
      // const rc = await retry(() => f(stmt));
      const rc = f(stmt);

      return check(fname, rc, mapStmtToDB.get(stmt), [SQLite.SQLITE_ROW, SQLite.SQLITE_DONE]);
    };
  })();

  sqlite3.commit_hook = function(db, xCommitHook) {
    verifyDatabase(db);
    Module.commit_hook(db, xCommitHook);
  };

  sqlite3.update_hook = function(db, xUpdateHook) {
    verifyDatabase(db);

    // Convert SQLite callback arguments to JavaScript-friendly arguments.
    function cvtArgs(iUpdateType, dbName, tblName, lo32, hi32) {
      return [
        iUpdateType,
        Module.UTF8ToString(dbName),
        Module.UTF8ToString(tblName),
		cvt32x2ToBigInt(lo32, hi32)
      ];
    };
    function adapt(f) {
      // return f instanceof AsyncFunction ?
      //   (async (iUpdateType, dbName, tblName, lo32, hi32) => f(...cvtArgs(iUpdateType, dbName, tblName, lo32, hi32))) :
      //   ((iUpdateType, dbName, tblName, lo32, hi32) => f(...cvtArgs(iUpdateType, dbName, tblName, lo32, hi32)));
      return ((iUpdateType, dbName, tblName, lo32, hi32) => f(...cvtArgs(iUpdateType, dbName, tblName, lo32, hi32)));
    }

    Module.update_hook(db, adapt(xUpdateHook));
  };;

  // Session extension bindings
  sqlite3.session_create = (function() {
    const fname = 'sqlite3session_create';
    const f = Module.cwrap(fname, ...decl('nsn:n'));
    return function(db, zDb) {
      verifyDatabase(db);
      const ppSession = Module._malloc(4);
      const result = f(db, zDb, ppSession);

      if (result !== SQLite.SQLITE_OK) {
        check(fname, result, db);
      }

      const pSession = Module.getValue(ppSession, 'i32');
      return pSession;
    };
  })();

  sqlite3.session_attach = (function() {
    const fname = 'sqlite3session_attach';
    const f = Module.cwrap(fname, ...decl('ns:n'));
    return function(pSession, zTab) {
      if (typeof pSession !== 'number') {
        throw new SQLiteError('Invalid session object', SQLite.SQLITE_MISUSE);
      }
      const result = f(pSession, zTab);
      return check(fname, result);
    };
  })();

  sqlite3.session_enable = (function() {
    const fname = 'sqlite3session_enable';
    const f = Module.cwrap(fname, ...decl('nn:n'));
    return function(pSession, enableBool) {
      const enable = enableBool ? 1 : 0;
      if (typeof pSession !== 'number') {
        throw new SQLiteError('Invalid session object', SQLite.SQLITE_MISUSE);
      }
      const result = f(pSession, enable);
      if (result !== enable) {
        throw new SQLiteError('Failed to enable session', SQLite.SQLITE_MISUSE);
      }
    };
  })();

  sqlite3.session_changeset = (function() {
    const fname = 'sqlite3session_changeset';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(pSession) {
      if (typeof pSession !== 'number') {
        throw new SQLiteError('Invalid session object', SQLite.SQLITE_MISUSE);
      }
      
      // Allocate memory for the size (int) and the changeset pointer (void*)
      const sizePtr = Module._malloc(4);
      const changesetPtrPtr = Module._malloc(4);
      
      try {
        const result = f(pSession, sizePtr, changesetPtrPtr);
        if (result === SQLite.SQLITE_OK) {
          // Get the size of the changeset
          const size = Module.getValue(sizePtr, 'i32');
          // Get the pointer to the changeset
          const changesetPtr = Module.getValue(changesetPtrPtr, 'i32');
          
          // Ensure the pointer is valid before accessing memory
          if (changesetPtr === 0) {
            return {
              result: result,
              size: 0,
              changeset: null
            }
          }

          // Copy the changeset data
          const changeset = new Uint8Array(Module.HEAPU8.subarray(changesetPtr, changesetPtr + size));

          // Free the allocated changeset memory
          Module._sqlite3_free(changesetPtr);
          
          // Return a copy of the changeset
          return {
            result: result,
            size: size,
            changeset: changeset
          };
        }
        return check(fname, result);
      } finally {
        // Free the allocated memory
        Module._free(sizePtr);
        Module._free(changesetPtrPtr);
      }
    };
  })();

  sqlite3.session_delete = (function() {
    const fname = 'sqlite3session_delete';
    const f = Module.cwrap(fname, ...decl('n:v'));
    return function(pSession) {
      if (typeof pSession !== 'number') {
        throw new SQLiteError('Invalid session object', SQLite.SQLITE_MISUSE);
      }
      const result = f(pSession);
      return result;
    };
  })();

  sqlite3.changeset_start = (function() {
    const fname = 'sqlite3changeset_start';
    const f = Module.cwrap(fname, ...decl('nnn:n'));
    return function(changesetData) {
      // Allocate memory for the input changeset data
      const inPtr = Module._sqlite3_malloc(changesetData.length);
      Module.HEAPU8.subarray(inPtr).set(changesetData);

      // Allocate memory for the changeset iterator pointer
      const ppIter = Module._malloc(4);

      try {
        // Call the wrapped C function
        const result = f(ppIter, changesetData.length, inPtr);

        if (result !== SQLite.SQLITE_OK) {
          check(fname, result); // Handle errors appropriately
        }

        // Retrieve the changeset iterator handle
        const pIter = Module.getValue(ppIter, 'i32');

        return pIter;
      } finally {
        // Free allocated memory
        Module._sqlite3_free(inPtr);
        Module._free(ppIter);
      }
    };
  })();

  sqlite3.changeset_finalize = (function() {
    const fname = 'sqlite3changeset_finalize';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pIter) {
      const result = f(pIter);
      return result;
    };
  })();

  sqlite3.changeset_invert = (function() {
    const fname = 'sqlite3changeset_invert';
    const f = Module.cwrap(fname, ...decl('nn:nn'));
    return function(changesetData) {
      // Allocate memory for the input changeset data
      const inPtr = Module._sqlite3_malloc(changesetData.length);
      Module.HEAPU8.subarray(inPtr).set(changesetData);

      // Allocate memory for the output changeset length and pointer
      const outLengthPtr = Module._malloc(4);
      const outPtrPtr = Module._malloc(4);

      // Call the wrapped C function
      const result = f(changesetData.length, inPtr, outLengthPtr, outPtrPtr);

      if (result !== SQLite.SQLITE_OK) {
        check(fname, result); // Handle errors appropriately
      }

      // Retrieve the size and pointer of the inverted changeset
      const outLength = Module.getValue(outLengthPtr, 'i32');
      const changesetOutPtr = Module.getValue(outPtrPtr, 'i32');

      // Copy the inverted changeset data
      const changesetOut = new Uint8Array(Module.HEAPU8.buffer, changesetOutPtr, outLength).slice();

      // Free allocated memory
      Module._sqlite3_free(inPtr);

      // TODO investigate why freeing these pointers causes a crash
      // RuntimeError: Out of bounds memory access (evaluating 'Module._sqlite3_free(outLengthPtr)')
      // Repro: https://gist.github.com/schickling/08b10b6fda8583601e586cb0bea333ce

      // Module._sqlite3_free(outLengthPtr);
      // Module._sqlite3_free(outPtrPtr);

      Module._sqlite3_free(changesetOutPtr);

      return changesetOut;
    };
  })();

  /** 
   * Convenience function to get an inverted changeset from a session
   * without having to call sqlite3session_changeset() and then sqlite3changeset_invert().
   * It's more efficient as it's reusing the same memory allocation for the changeset.
   */
  sqlite3.session_changeset_inverted = (function() {
    const fnameChangeset = 'sqlite3session_changeset';
    const fChangeset = Module.cwrap(fnameChangeset, ...decl('nnn:n'));
    const fnameInvert = 'sqlite3changeset_invert';
    const fInvert = Module.cwrap(fnameInvert, ...decl('nn:nn'));
    return function(pSession) {
      if (typeof pSession !== 'number') {
        throw new SQLiteError('Invalid session object', SQLite.SQLITE_MISUSE);
      }

      // Allocate memory for the size (int) and the changeset pointer (void*)
      const sizePtr = Module._malloc(4);
      const changesetPtrPtr = Module._malloc(4);

      // Allocate memory for the size (int) and the inverted changeset pointer (void*)
      const sizePtrInvert = Module._malloc(4);
      const changesetPtrPtrInvert = Module._malloc(4);
      
      try {
        const changesetResult = fChangeset(pSession, sizePtr, changesetPtrPtr);
        if (changesetResult !== SQLite.SQLITE_OK) {
          return check(fnameChangeset, changesetResult);
        }

        // Get the size of the changeset
        const size = Module.getValue(sizePtr, 'i32');
        // Get the pointer to the changeset
        const changesetPtr = Module.getValue(changesetPtrPtr, 'i32');

        
        const invertedResult = fInvert(size, changesetPtr, sizePtrInvert, changesetPtrPtrInvert);
        
        if (invertedResult !== SQLite.SQLITE_OK) {
          return check(fnameInvert, invertedResult);
        }

        // Get the size of the changeset
        const sizeInvert = Module.getValue(sizePtrInvert, 'i32');
        // Get the pointer to the changeset
        const changesetPtrInvert = Module.getValue(changesetPtrPtrInvert, 'i32');
        
        // Copy the changeset data
        const changesetInvert = new Uint8Array(Module.HEAPU8.buffer, changesetPtrInvert, sizeInvert);

        Module._sqlite3_free(changesetPtr);
        Module._sqlite3_free(changesetPtrInvert)

        // Return a copy of the changeset
        return {
          result: changesetResult,
          size: size,
          changeset: new Uint8Array(changesetInvert)
        };
      } finally {
        // Free the allocated memory
        Module._free(sizePtr);
        Module._free(changesetPtrPtr);
        Module._free(sizePtrInvert);
        Module._free(changesetPtrPtrInvert);
      }

    };
  })();

  sqlite3.changeset_apply = (function() {
    const fname = 'sqlite3changeset_apply';
    const f = Module.cwrap(fname, ...decl('nnnnnn:n'));
    return function(db, changesetData, options) {
      /*
        int sqlite3changeset_apply(
          sqlite3 *db,                    Apply change to "main" db of this handle
          int nChangeset,                 Size of changeset in bytes 
          void *pChangeset,               Changeset blob
          int(*xFilter)(
            void *pCtx,                   Copy of sixth arg to _apply() 
            const char *zTab              Table name 
          ),
          int(*xConflict)(
            void *pCtx,                   Copy of sixth arg to _apply() 
            int eConflict,                DATA, MISSING, CONFLICT, CONSTRAINT 
            sqlite3_changeset_iter *p     Handle describing change and conflict
          ),
          void *pCtx                      First argument passed to xConflict
        );
      */
      const inPtr = Module._sqlite3_malloc(changesetData.length);
      Module.HEAPU8.subarray(inPtr).set(changesetData);

      // https://sqlite.org/session/c_changeset_abort.html
      const SQLITE_CHANGESET_REPLACE = 1
      const onConflict = () => {
        return SQLITE_CHANGESET_REPLACE;
      }

      const result = f(db, changesetData.length, inPtr, null, onConflict, null);

      Module._sqlite3_free(inPtr);

      if (result !== SQLite.SQLITE_OK) {
        check(fname, result);
      }

      return result;
    }
  })();

  // Session extension bindings end

  sqlite3.value = function(pValue) {
    const type = sqlite3.value_type(pValue);
    switch (type) {
      case SQLite.SQLITE_BLOB:
        return sqlite3.value_blob(pValue);
      case SQLite.SQLITE_FLOAT:
        return sqlite3.value_double(pValue);
      case SQLite.SQLITE_INTEGER:
        const lo32 = sqlite3.value_int(pValue);
        const hi32 = Module.getTempRet0();
        return cvt32x2AsSafe(lo32, hi32);
      case SQLite.SQLITE_NULL:
        return null;
      case SQLite.SQLITE_TEXT:
        return sqlite3.value_text(pValue);
      default:
        throw new SQLiteError('unknown type', type);
    }
  };

  sqlite3.value_blob = (function() {
    const fname = 'sqlite3_value_blob';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pValue) {
      const nBytes = sqlite3.value_bytes(pValue);
      const address = f(pValue);
      const result = Module.HEAPU8.subarray(address, address + nBytes);
      return result;
    };
  })();

  sqlite3.value_bytes = (function() {
    const fname = 'sqlite3_value_bytes';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pValue) {
      const result = f(pValue);
      return result;
    };
  })();

  sqlite3.value_double = (function() {
    const fname = 'sqlite3_value_double';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pValue) {
      const result = f(pValue);
      return result;
    };
  })();

  sqlite3.value_int = (function() {
    const fname = 'sqlite3_value_int64';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pValue) {
      const result = f(pValue);
      return result;
    };
  })();

  sqlite3.value_int64 = (function() {
    const fname = 'sqlite3_value_int64';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pValue) {
      const lo32 = f(pValue);
      const hi32 = Module.getTempRet0();
      const result = cvt32x2ToBigInt(lo32, hi32);
      return result;
    };
  })();

  sqlite3.value_text = (function() {
    const fname = 'sqlite3_value_text';
    const f = Module.cwrap(fname, ...decl('n:s'));
    return function(pValue) {
      const result = f(pValue);
      return result;
    };
  })();

  sqlite3.value_type = (function() {
    const fname = 'sqlite3_value_type';
    const f = Module.cwrap(fname, ...decl('n:n'));
    return function(pValue) {
      const result = f(pValue);
      return result;
    };
  })();

  const registeredVfs = new Set();

  sqlite3.vfs_register = function(vfs, makeDefault) {
    if (registeredVfs.has(vfs.name)) return
    const result = Module.vfs_register(vfs, makeDefault);
    const res = check('sqlite3_vfs_register', result);
    registeredVfs.add(vfs.name);
    return res
  };

  sqlite3.vfs_registered = registeredVfs;

  function check(fname, result, db = null, allowed = [SQLite.SQLITE_OK]) {
    if (allowed.includes(result)) return result;
    const message = db ?
      Module.ccall('sqlite3_errmsg', 'string', ['number'], [db]) :
      fname;
    throw new SQLiteError(message, result);
  }

  // This function is used to automatically retry failed calls that
  // have pending retry operations that should allow the retry to
  // succeed.
  async function retry(f) {
    let rc;
    do {
      // Wait for all pending retry operations to complete. This is
      // normally empty on the first loop iteration.
      if (Module.retryOps.length) {
        await Promise.all(Module.retryOps);
        Module.retryOps = [];
      }
      
      rc = await f();

      // Retry on failure with new pending retry operations.
    } while (rc && Module.retryOps.length);
    return rc;
  }

  return sqlite3;
}

// Helper function to use a more compact signature specification.
function decl(s) {
  const result = [];
  const m = s.match(/([ns@]*):([nsv@])/);
  switch (m[2]) {
    case 'n': result.push('number'); break;
    case 's': result.push('string'); break;
    case 'v': result.push(null); break;
  }

  const args = [];
  for (let c of m[1]) {
    switch (c) {
      case 'n': args.push('number'); break;
      case 's': args.push('string'); break;
    }
  }
  result.push(args);
  return result;
}
