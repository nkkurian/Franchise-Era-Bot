const express = require('express');
const router = express.Router();

const faReport = require('./fa-report');
const extReport = require('./ext-report');
const capReport = require('./cap-report');

module.exports = (client, doc) => {
    router.use('/reports/fa', faReport(client, doc));
    router.use('/reports/ext', extReport(client, doc));
    router.use('/reports/cap', capReport(client, doc));

    return router;
};