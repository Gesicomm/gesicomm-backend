'use strict';

const fs = require('fs');
const path = require('path');

const TMP_ROOT = path.join(process.cwd(), 'tmp');
const UPLOADS_TMP = path.join(TMP_ROOT, 'uploads');

function destinoTemporal(dir) {
  return (req, file, cb) => {
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  };
}

module.exports = {
  TMP_ROOT,
  UPLOADS_TMP,
  destinoTmp: destinoTemporal(TMP_ROOT),
  destinoUploadsTmp: destinoTemporal(UPLOADS_TMP),
};
