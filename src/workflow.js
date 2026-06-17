import './batchJobMonitoring/batchJobMonitoring.js'

D365Toolkit.workflows = {
    releaseSalesOrder: async function() {
        // workflow
    },

    exportInvoices: async function() {
        // workflow
    },

    monitorBatchJobs: async function() {
        BatchJobMonitor.run();
    },

    crossCheckInvoice: async function() {
        
    },

    createNewUser: async function() {
        
    },
};
