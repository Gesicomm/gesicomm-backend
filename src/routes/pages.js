const express = require('express');
const router = express.Router();
const PageController = require('../controllers/page.controller');

router.post('/listado', PageController.list);
router.post('/', PageController.create);
router.get('/:id', PageController.getById);

router.post('/:id/versions', PageController.createVersion);
router.get('/:id/versions', PageController.listVersions);

router.post('/:id/publish', PageController.publish);
router.post('/:id/rollback', PageController.rollback);

module.exports = router;
