const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/api/status', (req, res) => {
  res.json({ message: 'Backend de Gesicomm en construcción, funcionando correctamente.', status: 'working' });
});

app.listen(port, () => {
  console.log(`Servidor backend escuchando en http://localhost:${port}`);
});
