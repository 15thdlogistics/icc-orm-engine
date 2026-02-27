export class ORM_STATE {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/orm/rotate") {
      const body = await request.json();
      return this.handleRotation(body);
    }

    return new Response("Not Found", { status: 404 });
  }

  async handleRotation({ mission_id }) {
    const operators =
      (await this.state.storage.get("operators")) || [];

    if (!operators.length) {
      return json({ error: "NO_OPERATORS_AVAILABLE" }, 400);
    }

    const ranked = rank(operators);
    const selected = ranked[0];

    selected.rotation_count =
      (selected.rotation_count || 0) + 1;

    selected.last_primary_timestamp = Date.now();

    await this.state.storage.put("operators", ranked);

    await this.env["mission-comms"].fetch(
      "https://mission-comms/event",
      {
        method: "POST",
        body: JSON.stringify({
          mission_id,
          event: "ORM_ROTATION",
          new_primary: selected.operator_id
        })
      }
    );

    return json({
      status: "ROTATED",
      new_primary: selected.operator_id
    });
  }
}

function rank(list) {
  return list.sort((a, b) => {
    const aScore =
      a.relationship_score +
      a.availability_score -
      (a.rotation_count || 0) * 0.05;

    const bScore =
      b.relationship_score +
      b.availability_score -
      (b.rotation_count || 0) * 0.05;

    return bScore - aScore;
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
