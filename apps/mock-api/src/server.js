import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.MOCK_API_PORT || process.env.PORT || 8080);
const app = createApp();

app.listen(port, () => {
  console.log(new Date().toISOString(), `mock-api listening on http://localhost:${port}`);
});
