const axios = require('axios');

async function testApi() {
  try {
    const payload = {
      nombre: "pack de skin care",
      descripcion: null,
      precio_total: 269636,
      precio_minimo: 250000,
      principalProductId: 1,
      upsells: [
          {
              productId: 6,
              discountPercentage: 50
          },
          {
              productId: 7,
              discountPercentage: 50
          }
      ]
    };

    // We need a token to test this, so this won't work out of the box unless we login.
    // So let's write a script that bypasses the API and tests exactly the service function but pretending it's from the req.body.
  } catch (error) {
    console.error(error);
  }
}
