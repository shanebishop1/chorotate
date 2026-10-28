-- Better Auth >=1.7.3 uses (providerId, accountId), not issuer, as identity.
-- Keep the legacy issuer nullable so existing rows and the previous Worker
-- remain compatible during deployment. No users, sessions, or tokens are lost.
-- The unique provider key also fails closed if ambiguous legacy accounts exist.
CREATE TABLE account_upgrade (
  id TEXT NOT NULL PRIMARY KEY,
  issuer TEXT,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

INSERT INTO account_upgrade SELECT * FROM account;
DROP TABLE account;
ALTER TABLE account_upgrade RENAME TO account;
CREATE INDEX account_userId_idx ON account (userId);
CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (issuer, accountId);
CREATE UNIQUE INDEX account_providerId_accountId_uidx ON account (providerId, accountId);
