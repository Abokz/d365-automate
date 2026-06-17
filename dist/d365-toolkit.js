(() => {
  // src/core.js
  window.D365Toolkit = {
    version: "1.0.0",
    init() {
      console.log("D365 Toolkit Initialized.");
    },
    wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    async waitFor(selector) {
      while (!document.querySelector(selector)) {
        await this.wait(100);
      }
      return document.querySelector(selector);
    }
  };

  // src/d365.js
  D365Toolkit.openBatchJob = async function(id) {
  };
  D365Toolkit.exportGrid = async function() {
  };

  // src/workflow.js
  D365Toolkit.workflows = {
    releaseSalesOrder: async function() {
    },
    exportInvoices: async function() {
    },
    monitorBatchJobs: async function() {
    },
    crossCheckInvoice: async function() {
    },
    createNewUser: async function() {
    }
  };
})();
