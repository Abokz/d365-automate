(() => {
  // src/core.js
  window.D365Toolkit = {
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
    }
  };
})();
