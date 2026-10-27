import { createChatServer } from "./chat.js";

const port = Number(process.env.PORT ?? 8080);
const { http } = createChatServer();
http.listen(port, () => console.log(`chat on http://localhost:${port}`));
