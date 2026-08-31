const fs = require('fs');
const path = require('path');
const modelsDir = path.join(__dirname, 'src', 'models');

fs.readdirSync(modelsDir).forEach(file => {
  if (!file.endsWith('.js')) return;
  const content = fs.readFileSync(path.join(modelsDir, file), 'utf8');
  const lines = content.split('\n');
  let inEnum = false;
  let enumLineStart = 0;
  for (let i=0; i<lines.length; i++) {
    if (lines[i].includes('DataTypes.ENUM')) {
      inEnum = true;
      enumLineStart = i;
    }
    if (inEnum && lines[i].includes('comment:')) {
      console.log(`Found ENUM with comment in ${file} around line ${i + 1}`);
      inEnum = false;
    }
    // Simple heuristic: if we see '}' closing the column def
    if (inEnum && lines[i].includes('},')) {
      inEnum = false;
    }
  }
});
console.log("Done checking.");
