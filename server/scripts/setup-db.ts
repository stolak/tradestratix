/**
 * Creates the MySQL database if missing, then runs prisma db push.
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

const DATABASE_URL = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/tradestratix';
const dbName = 'tradestratix';

function findMysqlCli(): string | null {
  const candidates = [
    'mysql',
    'C:\\wamp64\\bin\\mysql\\mysql8.3.0\\bin\\mysql.exe',
    'C:\\wamp64\\bin\\mysql\\mysql8.2.0\\bin\\mysql.exe',
    'C:\\wamp64\\bin\\mysql\\mysql8.1.0\\bin\\mysql.exe',
    'C:\\wamp64\\bin\\mysql\\mysql8.0.31\\bin\\mysql.exe',
    'C:\\wamp64\\bin\\mysql\\mysql8.0.27\\bin\\mysql.exe',
    'C:\\wamp\\bin\\mysql\\mysql8.0.31\\bin\\mysql.exe'
  ];

  const wampRoots = ['C:\\wamp64\\bin\\mysql', 'C:\\wamp\\bin\\mysql'];
  for (const root of wampRoots) {
    try {
      if (fs.existsSync(root)) {
        for (const dir of fs.readdirSync(root)) {
          const exe = path.join(root, dir, 'bin', 'mysql.exe');
          if (fs.existsSync(exe)) candidates.push(exe);
        }
      }
    } catch {
      // ignore
    }
  }

  for (const c of candidates) {
    try {
      const result = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (result.status === 0) return c;
    } catch {
      // continue
    }
  }
  return null;
}

function createDatabase() {
  const mysql = findMysqlCli();
  if (!mysql) {
    console.warn('mysql CLI not found. Skipping CREATE DATABASE.');
    console.warn(`If needed, run: CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    return;
  }

  console.log(`Using MySQL CLI: ${mysql}`);
  const sql = `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
  const result = spawnSync(mysql, ['-u', 'root', '-e', sql], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.warn('CREATE DATABASE failed:', result.stderr || result.stdout);
    console.warn('Continuing — Prisma may still connect if DB already exists.');
  } else {
    console.log(`Database \`${dbName}\` ready.`);
  }
}

function prismaPush() {
  console.log('Running prisma generate + db push...');
  console.log('DATABASE_URL:', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
  execSync('npx prisma generate', { cwd: serverRoot, stdio: 'inherit' });
  execSync('npx prisma db push', { cwd: serverRoot, stdio: 'inherit' });
  console.log('Schema pushed to MySQL.');
}

createDatabase();
prismaPush();
