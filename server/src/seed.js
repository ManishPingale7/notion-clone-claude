// Seeds demo accounts + example content: `npm run seed`. Safe to run repeatedly.
import { openDb } from './db.js';
import { seedDemo } from './demo.js';

openDb();
if (seedDemo()) console.log('Seeded demo data:');
else console.log('Demo data already present:');
console.log('  alice@example.com / password123  (owner of "Acme Inc")');
console.log('  bob@example.com   / password123  (member of "Acme Inc")');
