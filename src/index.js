import { ORM_STATE } from "./orm-do.js";

export { ORM_STATE };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/rotate") {
      const body = await request.json();
      return rotate(body, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function rotate(input, env) {
  const { mission_id, organization_id } = input;

  const id = env.ORM_STATE.idFromName(organization_id);
  const stub = env.ORM_STATE.get(id);

  const res = await stub.fetch("https://orm/rotate", {
    method: "POST",
    body: JSON.stringify({ mission_id })
  });

  return res;
}

