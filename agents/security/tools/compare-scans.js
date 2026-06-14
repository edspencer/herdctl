#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const prevFile = process.argv[2];
const currFile = process.argv[3];

const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
const curr = JSON.parse(fs.readFileSync(currFile, 'utf8'));

const prevIds = new Set(Object.keys(prev.advisories || {}));
const currIds = new Set(Object.keys(curr.advisories || {}));

const newIds = [...currIds].filter(id => !prevIds.has(id));
const removedIds = [...prevIds].filter(id => !currIds.has(id));

console.log('Previous scan vulnerabilities:', prev.metadata.vulnerabilities);
console.log('Current scan vulnerabilities:', curr.metadata.vulnerabilities);
console.log('');
console.log('New advisories:', newIds.length);
console.log('Removed advisories:', removedIds.length);
console.log('');

if (newIds.length > 0) {
  console.log('=== NEW VULNERABILITIES ===');
  newIds.forEach(id => {
    const adv = curr.advisories[id];
    console.log(`- ID ${id}: ${adv.title}`);
    console.log(`  Severity: ${adv.severity}`);
    console.log(`  Package: ${adv.module_name}`);
    console.log(`  Vulnerable: ${adv.vulnerable_versions}`);
    console.log(`  Patched: ${adv.patched_versions}`);
    console.log(`  URL: ${adv.url}`);
    console.log('');
  });
}

if (removedIds.length > 0) {
  console.log('=== REMOVED VULNERABILITIES ===');
  removedIds.forEach(id => {
    const adv = prev.advisories[id];
    console.log(`- ID ${id}: ${adv.title}`);
    console.log(`  Severity: ${adv.severity}`);
    console.log(`  Package: ${adv.module_name}`);
    console.log('');
  });
}
