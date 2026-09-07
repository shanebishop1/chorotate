-- LOCAL DEVELOPMENT SEED ONLY. The local auth identity below is deliberately
-- non-production and is usable only by the build/runtime/loopback gates in the
-- application. Never add real values or wildcard/domain-wide access here.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO households
 (id,name,time_zone,week_start,created_at,reminder_send_local_time)
VALUES ('chorotate','ChoRotate','UTC',1,'2026-08-31T00:00:00Z','09:00');
INSERT OR IGNORE INTO members
 (id,household_id,display_name,active,created_at,sms_phone_e164,sms_consent_status,sms_suppression_status) VALUES
 ('member-a','chorotate','Member A',1,'2026-08-31T00:00:00Z',NULL,'not_recorded','not_suppressed'),
 ('member-b','chorotate','Member B',1,'2026-08-31T00:00:00Z',NULL,'not_recorded','not_suppressed'),
 ('member-c','chorotate','Member C',1,'2026-08-31T00:00:00Z',NULL,'not_recorded','not_suppressed'),
 ('member-d','chorotate','Member D',1,'2026-08-31T00:00:00Z',NULL,'not_recorded','not_suppressed');
INSERT OR IGNORE INTO allowlisted_identities (id,household_id,member_id,email_normalized,auth_user_id,active,created_at) VALUES
 ('identity-member-a','chorotate','member-a','local@example.invalid','local-dev-user',1,'2026-08-31T00:00:00Z'),
 ('identity-member-b','chorotate','member-b','member-b@replace-me.example.invalid',NULL,1,'2026-08-31T00:00:00Z'),
 ('identity-member-c','chorotate','member-c','member-c@replace-me.example.invalid',NULL,1,'2026-08-31T00:00:00Z'),
 ('identity-member-d','chorotate','member-d','member-d@replace-me.example.invalid',NULL,1,'2026-08-31T00:00:00Z');
INSERT OR IGNORE INTO "user" (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('local-dev-user','Local development member','local@example.invalid',1,NULL,'2026-08-31T00:00:00Z','2026-08-31T00:00:00Z');
INSERT OR IGNORE INTO chores
 (id,household_id,name,active,created_at,instructions,ownership_start_weekday) VALUES
 ('trash','chorotate','Trash',1,'2026-08-31T00:00:00Z','Take the trash out and replace bags.',5),
 ('dishwasher','chorotate','Dishwasher',1,'2026-08-31T00:00:00Z','Empty the completed dishwasher.',1);
INSERT OR IGNORE INTO rotation_configs (id,household_id,chore_id,effective_from,rotation_offset,created_at) VALUES
 ('rotation-trash-2026-08-28','chorotate','trash','2026-08-28',0,'2026-08-31T00:00:00Z'),
 ('rotation-dishwasher-2026-08-31','chorotate','dishwasher','2026-08-31',2,'2026-08-31T00:00:00Z');
INSERT OR IGNORE INTO rotation_config_members (household_id,rotation_config_id,member_id,position) VALUES
 ('chorotate','rotation-trash-2026-08-28','member-a',0),('chorotate','rotation-trash-2026-08-28','member-b',1),
 ('chorotate','rotation-trash-2026-08-28','member-c',2),('chorotate','rotation-trash-2026-08-28','member-d',3),
 ('chorotate','rotation-dishwasher-2026-08-31','member-a',0),('chorotate','rotation-dishwasher-2026-08-31','member-b',1),
 ('chorotate','rotation-dishwasher-2026-08-31','member-c',2),('chorotate','rotation-dishwasher-2026-08-31','member-d',3);

-- Four authoritative weeks: Member A/Member C, Member B/Member D, Member C/Member A, Member D/Member B.
INSERT OR IGNORE INTO weekly_assignments
 (id,household_id,local_week_start,chore_id,member_id,version,source,actor_member_id,request_id,operation_id,operation_kind,occurred_at) VALUES
 ('assignment:chorotate:2026-08-28:trash','chorotate','2026-08-28','trash','member-a',1,'rotation',NULL,'seed:2026-08-28:trash','seed:2026-08-28:trash','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-08-31:dishwasher','chorotate','2026-08-31','dishwasher','member-c',1,'rotation',NULL,'seed:2026-08-31:dishwasher','seed:2026-08-31:dishwasher','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-09-04:trash','chorotate','2026-09-04','trash','member-b',1,'rotation',NULL,'seed:2026-09-04:trash','seed:2026-09-04:trash','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-09-07:dishwasher','chorotate','2026-09-07','dishwasher','member-d',1,'rotation',NULL,'seed:2026-09-07:dishwasher','seed:2026-09-07:dishwasher','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-09-11:trash','chorotate','2026-09-11','trash','member-c',1,'rotation',NULL,'seed:2026-09-11:trash','seed:2026-09-11:trash','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-09-14:dishwasher','chorotate','2026-09-14','dishwasher','member-a',1,'rotation',NULL,'seed:2026-09-14:dishwasher','seed:2026-09-14:dishwasher','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-09-18:trash','chorotate','2026-09-18','trash','member-d',1,'rotation',NULL,'seed:2026-09-18:trash','seed:2026-09-18:trash','materialize','2026-08-31T00:00:00Z'),
 ('assignment:chorotate:2026-09-21:dishwasher','chorotate','2026-09-21','dishwasher','member-b',1,'rotation',NULL,'seed:2026-09-21:dishwasher','seed:2026-09-21:dishwasher','materialize','2026-08-31T00:00:00Z');
