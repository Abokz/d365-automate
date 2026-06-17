window.D365Toolkit = {
    version: '1.0.0',

    wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    },

    async waitFor(selector) {
        while (!document.querySelector(selector)) {
            await this.wait(100);
        }

        return document.querySelector(selector);
    }
};
