// Example templates and conversations loaded the first time the app opens in a browser.
// All names and businesses are made up.
window.PS_SEEDS = {
  "templates": [
    {
      "id": "example-cold-lead-email",
      "name": "Example: Cold lead re-engagement email",
      "object": "Lead",
      "description": "Drafts a short, personal email to warm up a lead that went quiet. A rep reviews before sending.",
      "format": "text",
      "tier": "complex",
      "body": "You are a sales assistant for {{company_name}}, a small business that sells {{what_we_sell}}.\n\nWrite a short re-engagement email to a lead who has gone quiet.\n\nLead details:\n- Name: {{lead_name}}\n- Their business: {{lead_company}}\n- Last contact: {{last_contact_date}}\n- What they were interested in: {{interest}}\n- Notes from the CRM: {{crm_notes}}\n\nRules:\n- Under 120 words, friendly and plain-spoken, no hype.\n- Reference one specific detail from the notes so it doesn't read like a template.\n- End with one easy, low-pressure question.\n- Sign off as {{rep_name}}.\n\nFormat:\nSubject: <subject line>\n\n<email body>",
      "inputs": [
        {
          "key": "company_name",
          "label": "Our company",
          "type": "short",
          "sample": "Example: Brightside Landscaping"
        },
        {
          "key": "what_we_sell",
          "label": "What we sell",
          "type": "short",
          "sample": "seasonal lawn care and patio installs"
        },
        {
          "key": "lead_name",
          "label": "Lead name",
          "type": "short",
          "sample": "Example: Dana Ruiz"
        },
        {
          "key": "lead_company",
          "label": "Lead's business",
          "type": "short",
          "sample": "Example: Ruiz Family Dental (office building with front lawn)"
        },
        {
          "key": "last_contact_date",
          "label": "Last contact",
          "type": "short",
          "sample": "August 14"
        },
        {
          "key": "interest",
          "label": "Interested in",
          "type": "short",
          "sample": "Fall cleanup and a quote for a new walkway"
        },
        {
          "key": "crm_notes",
          "label": "CRM notes",
          "type": "long",
          "sample": "Asked for walkway quote, said budget is tight until Q4. Mentioned patients complain about muddy entrance after rain."
        },
        {
          "key": "rep_name",
          "label": "Rep name",
          "type": "short",
          "sample": "Sam"
        }
      ]
    },
    {
      "id": "example-lead-scoring",
      "name": "Example: Lead scoring and next step",
      "object": "Lead",
      "description": "Scores a lead 0-100, labels it cold/warm/hot, and suggests the next action. Returns fields you could write back to the CRM.",
      "format": "json",
      "tier": "complex",
      "body": "You score sales leads for {{company_name}}.\n\nOur ideal customer: {{ideal_customer}}\n\nLead record:\n- Name: {{lead_name}}\n- Source: {{lead_source}}\n- Days since last reply: {{days_since_reply}}\n- Activity history: {{activity}}\n\nScore this lead from 0 to 100 for likelihood to buy in the next 60 days.\n\nReturn a JSON object with exactly these fields:\n{\"score\": number, \"temperature\": \"cold\" | \"warm\" | \"hot\", \"reasons\": [up to 3 short strings], \"next_step\": string, \"suggested_follow_up_days\": number}",
      "inputs": [
        {
          "key": "company_name",
          "label": "Our company",
          "type": "short",
          "sample": "Example: Brightside Landscaping"
        },
        {
          "key": "ideal_customer",
          "label": "Ideal customer",
          "type": "long",
          "sample": "Local businesses or homeowners with properties over 1/4 acre who want recurring maintenance, budget $200+/month."
        },
        {
          "key": "lead_name",
          "label": "Lead name",
          "type": "short",
          "sample": "Example: Dana Ruiz, Ruiz Family Dental"
        },
        {
          "key": "lead_source",
          "label": "Lead source",
          "type": "short",
          "sample": "Website quote form"
        },
        {
          "key": "days_since_reply",
          "label": "Days since last reply",
          "type": "short",
          "sample": "42"
        },
        {
          "key": "activity",
          "label": "Activity history",
          "type": "long",
          "sample": "Requested walkway quote. Opened 2 of 3 follow-up emails. Clicked pricing page last week. Said budget frees up in Q4."
        }
      ]
    },
    {
      "id": "example-preference-capture",
      "name": "Example: Capture preferences from a conversation",
      "object": "Contact",
      "description": "Reads a whole text thread with a customer and pulls out preferences, budget, decision maker and follow-ups, with quotes as evidence.",
      "format": "json",
      "tier": "complex",
      "body": "You are a CRM assistant for {{company_name}}. Read the full text conversation below between our team and one customer, and pull out every preference worth saving to that customer's CRM record.\n\nRules:\n- Only use what the customer actually said. Don't guess.\n- Use null for anything the conversation doesn't mention.\n- For each preference, quote the customer's own words as evidence (keep quotes short).\n- If a preference changed over time, keep the most recent one.\n\nConversation ({{channel}}):\n<<<\n{{conversation}}\n>>>\n\nReturn a JSON object with exactly these fields:\n{\n  \"customer_name\": string,\n  \"summary\": \"one or two sentences a rep could read before calling\",\n  \"preferred_contact_method\": string | null,\n  \"best_time_to_contact\": string | null,\n  \"budget\": string | null,\n  \"decision_maker\": string | null,\n  \"sentiment\": \"positive\" | \"neutral\" | \"negative\",\n  \"products_of_interest\": [short strings],\n  \"preferences\": [{\"category\": string, \"preference\": string, \"evidence\": \"short quote\", \"date\": \"YYYY-MM-DD\"}],\n  \"follow_ups\": [things the business promised or should do next, with timing]\n}",
      "inputs": [
        {
          "key": "company_name",
          "label": "Our company",
          "type": "short",
          "sample": "Example: Brightside Landscaping"
        },
        {
          "key": "channel",
          "label": "Channel",
          "type": "short",
          "sample": "SMS"
        },
        {
          "key": "conversation",
          "label": "Conversation",
          "type": "conversation",
          "sample": "example-marcus-lee-sms"
        }
      ]
    }
  ],
  "conversations": [
    {
      "id": "example-marcus-lee-sms",
      "name": "Example: Marcus Lee",
      "channel": "SMS",
      "file": "samples/sample-sms-thread-marcus-lee.txt"
    }
  ]
};
