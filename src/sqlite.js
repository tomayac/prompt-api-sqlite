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
  const response = await promiser('exec', {
    dbId,
    sql: `SELECT uuid FROM sessions ORDER BY rowid;`,
    rowMode: 'array',
  });
  log(
    `SELECT uuid FROM sessions ORDER BY rowid; -> Fetched ${response.result.resultRows.length} UUIDs`,
  );
  return response.result.resultRows.map((row) => row[0]);
};

const loadSession = async (uuid) => {
  const summaryResponse = await promiser('exec', {
    dbId,
    sql: `SELECT conversation_summary FROM sessions WHERE uuid = $uuid;`,
    bind: { $uuid: uuid },
    rowMode: 'array',
  });
  log(
    `SELECT conversation_summary FROM sessions WHERE uuid = $uuid; (bind: ${uuid})`,
  );

  let conversationSummary = null;
  if (summaryResponse.result.resultRows.length > 0) {
    conversationSummary = summaryResponse.result.resultRows[0][0];
  }

  const promptsResponse = await promiser('exec', {
    dbId,
    sql: `SELECT role, content, image FROM prompts WHERE session_uuid = $uuid ORDER BY id;`,
    bind: { $uuid: uuid },
    rowMode: 'array',
  });
  log(
    `SELECT role, content, image FROM prompts WHERE session_uuid = $uuid ORDER BY id; (bind: ${uuid})`,
  );

  const initialPrompts = promptsResponse.result.resultRows.map((row) => {
    const role = row[0];
    const textContent = row[1];
    const imageBlobData = row[2];

    if (imageBlobData && imageBlobData.length > 0) {
      return {
        role: role,
        content: [
          {
            type: 'image',
            value: new Blob([imageBlobData], { type: 'image/*' }),
          },
        ],
      };
    } else {
      return {
        role: role,
        content: [{ type: 'text', value: textContent }],
      };
    }
  });

  return {
    conversationSummary,
    initialPrompts,
  };
};

const saveSession = async (uuid, options) => {
  await promiser('exec', {
    dbId,
    sql: `REPLACE INTO sessions (uuid, conversation_summary) VALUES ($uuid, $summary);`,
    bind: { $uuid: uuid, $summary: options.conversationSummary },
  });
  log(
    `REPLACE INTO sessions (uuid, conversation_summary) VALUES ($uuid, $summary); (bind: ${uuid}, ${options.conversationSummary})`,
  );

  await promiser('exec', {
    dbId,
    sql: `DELETE FROM prompts WHERE session_uuid = $uuid;`,
    bind: { $uuid: uuid },
  });
  log(`DELETE FROM prompts WHERE session_uuid = $uuid; (bind: ${uuid})`);

  for (const prompt of options.initialPrompts) {
    for (const contentPart of prompt.content) {
      if (contentPart.type === 'image' && contentPart.value instanceof Blob) {
        const imageBytes = await blobToUint8Array(contentPart.value);
        await promiser('exec', {
          dbId,
          sql: `INSERT INTO prompts (session_uuid, role, image)
                VALUES ($uuid, $role, $image);`,
          bind: {
            $uuid: uuid,
            $role: prompt.role,
            $image: imageBytes,
          },
        });
        log(`INSERT INTO prompts (session_uuid, role, image) ... (image)`);
      } else if (contentPart.type === 'text') {
        await promiser('exec', {
          dbId,
          sql: `INSERT INTO prompts (session_uuid, role, content)
                VALUES ($uuid, $role, $content);`,
          bind: {
            $uuid: uuid,
            $role: prompt.role,
            $content: contentPart.value,
          },
        });
        log(`INSERT INTO prompts (session_uuid, role, content) ... (text)`);
      }
    }
  }
};

const deleteSession = async (uuid) => {
  await promiser('exec', {
    dbId,
    sql: `DELETE FROM prompts WHERE session_uuid = $uuid;`,
    bind: { $uuid: uuid },
  });
  log(`DELETE FROM prompts WHERE session_uuid = $uuid; (bind: ${uuid})`);

  await promiser('exec', {
    dbId,
    sql: `DELETE FROM sessions WHERE uuid = $uuid;`,
    bind: { $uuid: uuid },
  });
  log(`DELETE FROM sessions WHERE uuid = $uuid; (bind: ${uuid})`);
};

const blobToUint8Array = async (blob) => {
  if (!(blob instanceof Blob)) {
    throw new TypeError('Expected a Blob object');
  }
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};
export { initializeSQLite, getUUIDs, loadSession, saveSession, deleteSession };
