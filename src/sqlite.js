/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { sqlite3Worker1Promiser } from '@sqlite.org/sqlite-wasm';

const log = console.log;
const error = console.error;

let promiser, dbId;

const initializeSQLite = async () => {
  try {
    promiser = await new Promise((resolve) => {
      const _promiser = sqlite3Worker1Promiser({
        onready: () => {
          resolve(_promiser);
        },
      });
    });

    let response;

    response = await promiser('config-get', {});
    log('Running SQLite3 version', response.result.version.libVersion);

    response = await promiser('open', {
      filename: 'file:worker-promiser.sqlite3?vfs=opfs',
    });
    const { dbId } = response;
    log(
      'OPFS is available, created persisted database at',
      response.result.filename.replace(/^file:(.*?)\?vfs=opfs/, '$1'),
    );

    await promiser('exec', {
      dbId,
      sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        uuid TEXT PRIMARY KEY,
        conversation_summary TEXT
      );
    `,
    });
    log(
      `CREATE TABLE IF NOT EXISTS sessions (uuid TEXT PRIMARY KEY, conversation_summary TEXT);`,
    );

    await promiser('exec', {
      dbId,
      sql: `
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uuid TEXT,
        role TEXT CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT,
        image BLOB,
        FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
      );`,
    });
    log(`
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uuid TEXT,
        role TEXT CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT,
        image BLOB,
        FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
      );
    `);
  } catch (err) {
    if (!(err instanceof Error)) {
      err = new Error(err.result.message);
    }
    error(err.name, err.message);
  }
};

const getUUIDs = async () => {
  const uuids = [];
  await promiser('exec', {
    dbId,
    sql: `SELECT uuid FROM sessions;`,
    callback: (result) => {
      if (!result.row) {
        return;
      }
      uuids.push(result.row[0]);
    },
  });
  log(`SELECT uuid FROM sessions;`);
  return uuids;
};

const loadSession = async (uuid) => {
  let conversationSummary;
  await promiser('exec', {
    dbId,
    sql: `SELECT conversation_summary FROM sessions WHERE uuid = '${uuid}';`,
    callback: (result) => {
      if (!result.row) {
        return;
      }
      conversationSummary = result.row[0];
    },
  });
  log(`SELECT conversation_summary FROM sessions WHERE uuid = '${uuid}';`);

  const initialPrompts = [];
  await promiser('exec', {
    dbId,
    sql: `SELECT role, content, image FROM prompts WHERE session_uuid = '${uuid}' ORDER BY id;`,
    callback: (result) => {
      if (!result.row) {
        return;
      }
      if (result.row[2]) {
        initialPrompts.push({
          role: result.row[0],
          content: [
            {
              type: 'image',
              value: new Blob([new Uint8Array(result.row[2])], {
                type: 'image/*',
              }),
            },
          ],
        });
        return;
      }
      initialPrompts.push({
        role: result.row[0],
        content: [{ type: 'text', value: result.row[1] }],
      });
    },
  });
  log(
    `SELECT role, content, image FROM prompts WHERE session_uuid = '${uuid}' ORDER BY id;`,
  );
  return {
    conversationSummary,
    initialPrompts,
  };
};

const saveSession = async (uuid, options) => {
  await promiser('exec', {
    dbId,
    sql: `REPLACE INTO sessions (uuid, conversation_summary) VALUES ('${uuid}', '${options.conversationSummary.replace(/'/g, "''")}');`,
  });
  log(
    `REPLACE INTO sessions (uuid, conversation_summary) VALUES ('${uuid}', '${options.conversationSummary.replace(/'/g, "''")}');`,
  );
  await promiser('exec', {
    dbId,
    sql: `DELETE FROM prompts WHERE session_uuid = '${uuid}';`,
  });
  log(`DELETE FROM prompts WHERE session_uuid = '${uuid}';`);

  for (const prompt of options.initialPrompts) {
    for (const content of prompt.content) {
      if (content.type === 'image') {
        const uint8 = await blobToUint8Array(content.value);
        await promiser('exec', {
          dbId,
          sql: `INSERT INTO prompts (session_uuid, role, content, image)
                VALUES ($uuid, $role, $content, $image);`,
          bind: {
            $uuid: uuid,
            $role: prompt.role,
            $content: null,
            $image: uint8,
          },
        });
        log(
          `INSERT INTO prompts (session_uuid, role, content, image) VALUES ($uuid, $role, $content, $image);`,
        );
      } else {
        await promiser('exec', {
          dbId,
          sql: `INSERT INTO prompts (session_uuid, role, content, image)
                    VALUES ('${uuid}', '${prompt.role}', '${content.value.replace(/'/g, "''")}', NULL);`,
        });
        log(
          `INSERT INTO prompts (session_uuid, role, content, image) VALUES ('${uuid}', '${prompt.role}', '${content.value.replace(/'/g, "''")}', NULL);`,
        );
      }
    }
  }
};

const deleteSession = async (uuid) => {
  await promiser('exec', {
    dbId,
    sql: `DELETE FROM prompts WHERE session_uuid = '${uuid}';\nDELETE FROM sessions WHERE uuid = '${uuid}';`,
  });
  console.log(
    `DELETE FROM prompts WHERE session_uuid = '${uuid}';\nDELETE FROM sessions WHERE uuid = '${uuid}';`,
  );
};

const blobToUint8Array = async (blob) => {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};

export { initializeSQLite, getUUIDs, loadSession, saveSession, deleteSession };
