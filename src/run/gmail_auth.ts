/** One-time Gmail authorisation: `npm run gmail-auth`. */
import { createInterface } from 'node:readline/promises';
import { authUrl, exchangeCode } from '../track/gmail.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log('\n1. Open this URL and grant read-only Gmail access:\n');
console.log(`   ${authUrl()}\n`);
console.log('2. Google will redirect to a localhost URL that fails to load. That is expected.');
console.log('   Copy the `code=` value out of that URL.\n');
const code = (await rl.question('Paste the code here: ')).trim();
rl.close();
await exchangeCode(code);
console.log('\nSaved config/gmail_token.json. Run `npm run inbox` now.');
