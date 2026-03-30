import initSqlJs, { type Database as SqlJsDatabase, type Statement } from 'sql.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let SQL: any = null;

async function getSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

function normalizeParams(args: any[]): any[] {
  const params = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  return params.map((v: any) => v === undefined ? null : v);
}

class MockStatement {
  private stmt: Statement;
  private db: SqlJsDatabase;

  constructor(sql: string, db: SqlJsDatabase) {
    this.db = db;
    try {
      this.stmt = db.prepare(sql);
    } catch (e) {
      throw new Error(`SQL Error: ${e instanceof Error ? e.message : String(e)}\nSQL: ${sql}`);
    }
  }

  run(...args: any[]) {
    const params = normalizeParams(args);
    this.stmt.bind(params);
    this.stmt.step();
    const changes = this.db.getRowsModified();
    this.stmt.reset();
    return { changes, lastInsertRowid: 0 }; // lastInsertRowid not easily available in sql.js without extra query
  }

  get(...args: any[]) {
    const params = normalizeParams(args);
    this.stmt.bind(params);
    const result = this.stmt.step() ? this.stmt.getAsObject() : undefined;
    this.stmt.reset();
    return result;
  }

  all(...args: any[]) {
    const params = normalizeParams(args);
    this.stmt.bind(params);
    const rows = [];
    while (this.stmt.step()) {
      rows.push(this.stmt.getAsObject());
    }
    this.stmt.reset();
    return rows;
  }

  finalize() {
    this.stmt.free();
  }
}

export class MockDatabase {
  static innerDb: SqlJsDatabase | null = null;
  private statements: MockStatement[] = [];

  constructor(path: string) {
    if (!MockDatabase.innerDb) {
      throw new Error('Static MockDatabase.innerDb must be initialized before creating instances.');
    }
  }

  get innerDb() {
    return MockDatabase.innerDb!;
  }

  pragma(sql: string) {
    return this;
  }

  prepare(sql: string) {
    const stmt = new MockStatement(sql, this.innerDb);
    this.statements.push(stmt);
    return stmt;
  }

  exec(sql: string) {
    this.innerDb.run(sql);
    return this;
  }

  transaction(fn: (...args: any[]) => any) {
    return (...args: any[]) => {
      this.innerDb.run('BEGIN');
      try {
        const result = fn(...args);
        this.innerDb.run('COMMIT');
        return result;
      } catch (e) {
        this.innerDb.run('ROLLBACK');
        throw e;
      }
    };
  }

  close() {
    for (const stmt of this.statements) {
      stmt.finalize();
    }
    // We don't close the static innerDb here because it might be reused or
    // we might want to reset it explicitly.
  }
}
