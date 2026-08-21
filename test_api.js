const axios = require('axios');
const jwt = require('jsonwebtoken');

(async () => {
  const token = jwt.sign({ id: 1, inquilino_id: 1, rol_id: 1 }, '6p1QXBXKlK0TwO4hoE1kAHNWkNfzKUYBkGkotqNKMLwjn4mscJwy4EqPpQ1JFUc7LUxXz9DhEJoXO7QpbKP1fQ==');
  const start = Date.now();
  try {
    const res = await axios.get('http://localhost:3000/api/vitrina/productos/1/sensibilidad', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Time:', Date.now() - start, 'ms');
  } catch (e) {
    console.error('Error:', e.response ? e.response.status : e.message);
  }
})();
