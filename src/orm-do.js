var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/orm-do.js
var ORM_STATE = class {
  static {
    __name(this, "ORM_STATE");
  }
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
    const operators = await this.state.storage.get("operators") || [];
    if (!operators.length) {
      return json({ error: "NO_OPERATORS_AVAILABLE" }, 400);
    }

    // Fetch mission compliance snapshot from document worker
    const docRes = await this.env["document-api"].fetch(
      "https://document-api/mission/compliance",
      {
        method: "POST",
        body: JSON.stringify({ mission_id })
      }
    );

    if (!docRes.ok) {
      return json({ error: "MISSION_COMPLIANCE_FETCH_FAILED" }, 500);
    }

    const mission = await docRes.json();
    const now = Date.now();

    // Enforce mission-level expiry blocks (milliseconds)
    if (
      (mission.permit_expiry && mission.permit_expiry < now) ||
      (mission.crew_cert_expiry && mission.crew_cert_expiry < now) ||
      (mission.maintenance_clearance_expiry && mission.maintenance_clearance_expiry < now)
    ) {
      return json({ error: "MISSION_COMPLIANCE_EXPIRED" }, 400);
    }

    // Enforce document risk rail
    if (typeof mission.document_risk_score === "number" && mission.document_risk_score > 0.6) {
      return json({ error: "MISSION_DOCUMENT_RISK_TOO_HIGH" }, 400);
    }

    // Hard block UNFIT and AT_RISK at rotation layer (FIT only)
    const eligible = operators.filter(
      (op) => op.compliance_status === "FIT"
    );

    if (!eligible.length) {
      return json({ error: "NO_COMPLIANCE_ELIGIBLE_OPERATORS" }, 400);
    }

    // Tier-sensitive compliance enforcement
    const tierFiltered = eligible.filter((op) => {
      if (mission.tier >= 3) {
        return (op.compliance_score || 0) >= 85;
      }
      return true;
    });

    if (!tierFiltered.length) {
      return json({ error: "NO_TIER_COMPLIANT_OPERATORS" }, 400);
    }

    const ranked = rank(tierFiltered);
    const selected = ranked[0];

    selected.rotation_count = (selected.rotation_count || 0) + 1;
    selected.last_primary_timestamp = now;

    // Persist updated rotation counts across full operator list
    const updatedOperators = operators.map((op) =>
      op.operator_id === selected.operator_id ? selected : op
    );

    await this.state.storage.put("operators", updatedOperators);

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
};

function rank(list) {
  return list
    .filter((op) => op.compliance_status === "FIT")
    .sort((a, b) => {
      const aScore =
        a.relationship_score +
        a.availability_score +
        (a.compliance_score * 0.3) -
        (a.rotation_count || 0) * 0.05;

      const bScore =
        b.relationship_score +
        b.availability_score +
        (b.compliance_score * 0.3) -
        (b.rotation_count || 0) * 0.05;

      return bScore - aScore;
    });
}
__name(rank, "rank");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");

// src/index.js
var index_default = {
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
__name(rotate, "rotate");

export {
  ORM_STATE,
  index_default as default
};