import { createApp } from './api/app.js';

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Portfolio simulator API listening on http://localhost:${port}`);
  });
}

export { app };
