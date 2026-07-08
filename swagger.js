const spec = {
  openapi: "3.0.3",
  info: {
    title: "Lead Pipeline API",
    description: "No-website & broken-site business finder for India. Scrapes Google Maps, manages leads in a CRM pipeline, and sends WhatsApp outreach messages.",
    version: "1.0.0",
  },
  servers: [{ url: "http://localhost:5000", description: "Development" }],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      TokenResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          user: { type: "object", properties: { username: { type: "string" } } },
        },
      },
      Business: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          phone: { type: "string" },
          rating: { type: "string" },
          reviews: { type: "string" },
          website_url: { type: "string" },
          website_status: { type: "string", enum: ["unchecked", "no_website", "working", "broken", "blocked"] },
          website_checked_at: { type: "string", nullable: true },
          location_query: { type: "string" },
          source: { type: "string" },
          scraped_on: { type: "string" },
          pipeline_status: { type: "string", enum: ["not_contacted", "contacted", "interested", "will_talk_later", "not_interested", "completed"] },
          pipeline_updated_at: { type: "string", nullable: true },
          notes: { type: "string" },
          message_sent: { type: "boolean" },
          message_sent_at: { type: "string", nullable: true },
          created_at: { type: "string" },
        },
      },
      BusinessesListResponse: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Business" } },
          total: { type: "integer" },
          totalPages: { type: "integer" },
          page: { type: "integer" },
          pageSize: { type: "integer" },
        },
      },
      UpsertResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          count: { type: "integer" },
          inserted: { type: "integer" },
          updated: { type: "integer" },
        },
      },
      StatsResponse: {
        type: "object",
        properties: {
          total: { type: "integer" },
          noWebsite: { type: "integer" },
          broken: { type: "integer" },
          byPipeline: { type: "array", items: { type: "object", properties: { pipeline_status: { type: "string" }, n: { type: "integer" } } } },
          byCity: { type: "array", items: { type: "object", properties: { city: { type: "string" }, n: { type: "integer" } } } },
        },
      },
      ScrapeResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          count: { type: "integer" },
          inserted: { type: "integer" },
          updated: { type: "integer" },
          skippedInRun: { type: "integer" },
          cancelled: { type: "boolean" },
          pendingWebsiteChecks: { type: "integer" },
        },
      },
      CheckWebsitesResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          checked: { type: "integer" },
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                website_status: { type: "string" },
                website_checked_at: { type: "string" },
              },
            },
          },
        },
      },
      WaStatusResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["disconnected", "connecting", "qr_ready", "connected"] },
          sendState: {
            type: "object",
            properties: {
              running: { type: "boolean" },
              paused: { type: "boolean" },
              index: { type: "integer" },
              sentCount: { type: "integer" },
              failCount: { type: "integer" },
              total: { type: "integer" },
            },
          },
        },
      },
      SendLogEntry: {
        type: "object",
        properties: {
          id: { type: "integer" },
          business_id: { type: "string" },
          business_name: { type: "string" },
          phone: { type: "string" },
          status: { type: "string" },
          reason: { type: "string" },
          sent_at: { type: "string" },
        },
      },
      PipelineHistoryEntry: {
        type: "object",
        properties: {
          id: { type: "integer" },
          business_id: { type: "string" },
          business_name: { type: "string" },
          old_status: { type: "string" },
          new_status: { type: "string" },
          changed_at: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user account",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["username", "password"], properties: { username: { type: "string" }, password: { type: "string", minLength: 6 } } } } },
        },
        responses: {
          "200": { description: "Account created", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } } } },
          "400": { description: "Missing or invalid fields", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "Username taken", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login and receive a JWT token",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["username", "password"], properties: { username: { type: "string" }, password: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } } } },
          "400": { description: "Missing fields", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/auth/check": {
      get: {
        tags: ["Auth"],
        summary: "Verify the current token is valid",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Token is valid", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" }, user: { type: "object", properties: { username: { type: "string" } } } } } } } },
          "401": { description: "Missing or invalid token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/auth/change-password": {
      post: {
        tags: ["Auth"],
        summary: "Change the authenticated user's password",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["currentPassword", "newPassword"], properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 6 } } } } },
        },
        responses: {
          "200": { description: "Password changed", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
          "400": { description: "Missing fields or too short", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Current password is wrong", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/config": {
      get: {
        tags: ["Config"],
        summary: "Get all config key-value pairs",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Config object", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        },
      },
      post: {
        tags: ["Config"],
        summary: "Upsert config key-value pairs",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", additionalProperties: true, example: { whatsapp_message: "Hello {name}", delay_seconds: 60 } } } },
        },
        responses: {
          "200": { description: "Saved", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
        },
      },
    },
    "/api/businesses": {
      get: {
        tags: ["Businesses"],
        summary: "List businesses with optional filters and pagination",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "search", in: "query", schema: { type: "string" }, description: "Search name, category, phone, or address" },
          { name: "website_status", in: "query", schema: { type: "string", enum: ["unchecked", "no_website", "working", "broken", "blocked"] } },
          { name: "pipeline_status", in: "query", schema: { type: "string", enum: ["not_contacted", "contacted", "interested", "will_talk_later", "not_interested", "completed"] } },
          { name: "city", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 100, maximum: 500 } },
        ],
        responses: {
          "200": { description: "Paginated list", content: { "application/json": { schema: { $ref: "#/components/schemas/BusinessesListResponse" } } } },
        },
      },
      post: {
        tags: ["Businesses"],
        summary: "Insert or update one or more businesses (dedup by phone)",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/Business" }, { type: "array", items: { $ref: "#/components/schemas/Business" } }] } } },
        },
        responses: {
          "200": { description: "Upsert result", content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertResponse" } } } },
        },
      },
      delete: {
        tags: ["Businesses"],
        summary: "Delete businesses by ID or all businesses",
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } } } },
        },
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
        },
      },
    },
    "/api/businesses/{id}": {
      patch: {
        tags: ["Businesses"],
        summary: "Partially update a business",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, category: { type: "string" }, address: { type: "string" }, city: { type: "string" }, phone: { type: "string" }, rating: { type: "string" }, reviews: { type: "string" }, website_url: { type: "string" }, website_status: { type: "string" }, pipeline_status: { type: "string", enum: ["not_contacted", "contacted", "interested", "will_talk_later", "not_interested", "completed"] }, notes: { type: "string" }, message_sent: { type: "boolean" }, message_sent_at: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Updated", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
          "400": { description: "Invalid pipeline_status", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/businesses/{id}/competitor-examples": {
      get: {
        tags: ["Businesses"],
        summary: "Find similar local businesses with working websites as proof for pitching",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Target business + up to 8 competitor examples", content: { "application/json": { schema: { type: "object", properties: { target: { $ref: "#/components/schemas/Business" }, examples: { type: "array", items: { $ref: "#/components/schemas/Business" } } } } } } },
          "404": { description: "Business not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/stats": {
      get: {
        tags: ["Stats"],
        summary: "Get aggregate statistics about the business database",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Statistics", content: { "application/json": { schema: { $ref: "#/components/schemas/StatsResponse" } } } },
        },
      },
    },
    "/api/check-websites": {
      post: {
        tags: ["Businesses"],
        summary: "Re-check website reachability for given businesses or all unchecked ones",
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } } } },
        },
        responses: {
          "200": { description: "Check results", content: { "application/json": { schema: { $ref: "#/components/schemas/CheckWebsitesResponse" } } } },
        },
      },
    },
    "/api/scrape": {
      post: {
        tags: ["Scraper"],
        summary: "Enqueue a Google Maps scrape job for a location and categories",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["location", "categories"], properties: { location: { type: "string", description: "City/town/area in India" }, categories: { type: "array", items: { type: "string" }, description: "Business categories to search" }, maxPerQuery: { type: "integer", default: 20 }, headless: { type: "boolean", default: true } } } } },
        },
        responses: {
          "200": { description: "Job enqueued", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, jobId: { type: "string" } } } } } },
          "400": { description: "Missing location or categories", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "A scrape is already running", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/scrape/cancel": {
      post: {
        tags: ["Scraper"],
        summary: "Cancel any running or pending scrape jobs",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Cancel result", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, cancelled: { type: "boolean" } } } } } },
        },
      },
    },
    "/api/scrape/status/{jobId}": {
      get: {
        tags: ["Scraper"],
        summary: "Poll the status and result of a scrape job",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Job state", content: { "application/json": { schema: { type: "object", properties: { jobId: { type: "string" }, state: { type: "string" }, result: { $ref: "#/components/schemas/ScrapeResult" }, error: { type: "string", nullable: true } } } } } },
          "404": { description: "Job not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/wa/connect": {
      post: {
        tags: ["WhatsApp"],
        summary: "Open WhatsApp Web in a browser and wait for QR scan",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Connection status (connected or qr_ready)", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, status: { type: "string" } } } } } },
          "500": { description: "Connection failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/wa/status": {
      get: {
        tags: ["WhatsApp"],
        summary: "Get WhatsApp connection status and send queue state",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Status", content: { "application/json": { schema: { $ref: "#/components/schemas/WaStatusResponse" } } } },
        },
      },
    },
    "/api/wa/disconnect": {
      post: {
        tags: ["WhatsApp"],
        summary: "Disconnect WhatsApp and close the browser",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Disconnected", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
        },
      },
    },
    "/api/wa/send": {
      post: {
        tags: ["WhatsApp"],
        summary: "Send WhatsApp messages to selected businesses",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["businesses", "message"], properties: { businesses: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, phone: { type: "string" }, category: { type: "string" } } } }, message: { type: "string", description: "Template with {name} and {category} placeholders" }, delaySeconds: { type: "integer", default: 60 } } } } },
        },
        responses: {
          "200": { description: "Send queued", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, total: { type: "integer" }, skippedDuplicates: { type: "integer" } } } } } },
          "400": { description: "Not connected or already sending", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/wa/pause": {
      post: {
        tags: ["WhatsApp"],
        summary: "Toggle pause/resume on the WhatsApp send queue",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Paused state", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, paused: { type: "boolean" } } } } } },
        },
      },
    },
    "/api/wa/stop": {
      post: {
        tags: ["WhatsApp"],
        summary: "Stop the WhatsApp send queue immediately",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Stopped", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
        },
      },
    },
    "/api/send-log": {
      get: {
        tags: ["WhatsApp"],
        summary: "Get the most recent 200 message send log entries",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "Log entries", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/SendLogEntry" } } } } },
        },
      },
    },
    "/api/pipeline-history": {
      get: {
        tags: ["Stats"],
        summary: "Get the most recent 300 pipeline status change history entries",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "History entries", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/PipelineHistoryEntry" } } } } },
        },
      },
    },
  },
};

export default spec;
