const express = require('express');
const router = express.Router();

// Import individual report files
const faReport = require('./fa-report');
const extReport = require('./ext-report');
// const capReport = require('./cap-report'); // Add this later!

module.exports = (client, doc) => {
    // Tell the router to use these files
    router.use('/', faReport(client, doc));
    router.use('/', extReport(client, doc));
    router.use('/', capReport(client));

    return router;
};
