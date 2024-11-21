const fs = require('fs');
const path = require('path');

function imageToBase64(filePath) {
  const image = fs.readFileSync(filePath);
  return Buffer.from(image).toString('base64');
}

// Convert images
const icons = {
  low: imageToBase64(path.resolve(__dirname, '../Icons/low.png')),
  lowDark: imageToBase64(path.resolve(__dirname, '../Icons/low_dark.png')),
  medium: imageToBase64(path.resolve(__dirname, '../Icons/medium.png')),
  mediumDark: imageToBase64(
    path.resolve(__dirname, '../Icons/medium_dark.png'),
  ),
  high: imageToBase64(path.resolve(__dirname, '../Icons/high.png')),
  highDark: imageToBase64(path.resolve(__dirname, '../Icons/high_dark.png')),
  urgent: imageToBase64(path.resolve(__dirname, '../Icons/urgent.png')),
  urgentDark: imageToBase64(
    path.resolve(__dirname, '../Icons/urgent_dark.png'),
  ),
  no_priority: imageToBase64(
    path.resolve(__dirname, '../Icons/no_priority.png'),
  ),
  no_priority_dark: imageToBase64(
    path.resolve(__dirname, '../Icons/no_priority_dark.png'),
  ),
  canceled: imageToBase64(path.resolve(__dirname, '../Icons/canceled.png')),
  triage: imageToBase64(path.resolve(__dirname, '../Icons/triage.png')),
  done: imageToBase64(path.resolve(__dirname, '../Icons/done.png')),
  in_progress: imageToBase64(
    path.resolve(__dirname, '../Icons/in_progress.png'),
  ),
  in_review: imageToBase64(path.resolve(__dirname, '../Icons/in_review.png')),
  todo: imageToBase64(path.resolve(__dirname, '../Icons/todo.png')),
  backlog: imageToBase64(path.resolve(__dirname, '../Icons/backlog.png')),
};

// Write to a ts file
const output = `
// Auto-generated file
export const iconBase64 = ${JSON.stringify(icons, null, 2)};
`;

fs.writeFileSync(path.resolve(__dirname, '../Icons/iconBase64.ts'), output);

console.log('Base64 icons generated!');
