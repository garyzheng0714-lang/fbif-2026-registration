# Submission Log Snapshot — 2026-03-05

## Metadata
- Source: `121.40.214.5` / `fbif_form` / table `Submission`
- Timezone in report: `Asia/Shanghai` (CST, UTC+8)
- Query time: `2026-03-05 09:37:xx CST`
- Range: latest 50 rows (actual rows returned: 34)

## Query
```sql
SELECT
  to_char(("createdAt" + interval '8 hour'),'YYYY-MM-DD HH24:MI:SS') AS created_at_cst,
  "id",
  "traceId",
  "role",
  "syncStatus",
  coalesce("clickIdSourceKey",'-') AS click_source,
  coalesce("clickId",'-') AS click_id,
  coalesce("trackingIdType",'-') AS tracking_id_type,
  coalesce("trackingId",'-') AS tracking_id,
  CASE WHEN coalesce(trim("trackingParams"),'')='' THEN '-' ELSE left("trackingParams",120) END AS tracking_params,
  coalesce("clientIp",'-') AS client_ip
FROM "Submission"
ORDER BY "createdAt" DESC
LIMIT 50;
```

## Rows
| created_at_cst | id | trace_id | role | sync_status | click_source | click_id | tracking_id_type | tracking_id | tracking_params | client_ip |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-03-05 09:37:04 | a48808e1-fbf4-43ef-b0f6-d71707f115b1 | 017457a5-daa4-41e7-9695-b959e1db6977 | consumer | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-05 09:29:21 | afb8e1f3-a469-4830-bec4-6c76684e81d6 | a285ad46-df38-4f29-a27c-68a3fedac935 | industry | FAILED | gdt_vid | wx03zb4wbxrl6knq01 | - | - | - | 183.195.121.126 |
| 2026-03-05 08:56:50 | 4b6178da-eacb-4405-a08d-4c43a9a8dca0 | 3ed94638-5a56-46d7-a1b4-b60b6746cda3 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-05 08:55:47 | 31c20e81-beb8-4e43-beb9-696f8227c842 | 89f69c9c-30f6-46af-a893-d7233dfa5dcb | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-05 04:20:35 | 23afdbec-36a5-466b-b18b-bcbd4d2e20a2 | 7edce24c-a943-467f-87a0-957a822593b1 | industry | SUCCESS | - | - | - | - | - | 183.192.12.92 |
| 2026-03-05 03:59:09 | 11eff056-753a-45bd-9a37-664d82705929 | 2937224d-449e-48d9-9559-817b81253907 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-05 02:14:53 | b06f071a-340b-4bb7-9930-b0c42a1dab37 | 513d0ab4-0426-4143-bd97-57d92ffcfe6d | consumer | SUCCESS | click_id | 88886969test | - | - | - | 58.34.68.18 |
| 2026-03-04 22:58:03 | a03b26fb-abf7-4a91-9fc1-6a265bde0372 | 0ca20022-cc10-4ada-8481-1b4cabe9cb4f | industry | SUCCESS | - | - | - | - | - | 58.247.23.106 |
| 2026-03-04 21:20:27 | 2610a926-723e-411f-895b-136b8a445fe2 | 3e119931-3a9a-4d48-b453-53e4cca0240e | industry | SUCCESS | gdt_vid | wx0uotz33hcgq5ig01 | - | - | - | 101.87.2.218 |
| 2026-03-04 21:05:32 | 73b1ec27-efe8-46b8-9008-3616b4873e21 | 69025cd6-c02b-49c8-acd6-9f5097ecde9b | industry | SUCCESS | - | - | - | - | - | 183.159.60.40 |
| 2026-03-04 19:20:57 | 6ee51400-d9c5-45d5-9715-d81e9bff5fc0 | d5b27c00-8b0e-4ee4-bbc2-2018af4d81ea | consumer | SUCCESS | - | - | - | - | - | 220.196.194.53 |
| 2026-03-04 19:19:03 | 23601fb3-5e0d-4b18-902a-4d125f6e23ca | 4cacbe38-306f-4be5-87d9-acab1ad19656 | industry | SUCCESS | - | - | - | - | - | 180.173.121.187 |
| 2026-03-04 18:48:53 | 32b59d6f-0568-44c4-a526-ab93d89ab71f | 623d7844-cfd7-432c-8117-38ee6cbff366 | consumer | SUCCESS | gdt_vid | wx0ml5layg5s5nxs00 | - | - | - | 39.144.103.7 |
| 2026-03-04 18:46:00 | bd85ecd7-9ff0-4371-b7fc-9248bd61f850 | 4025609d-1a19-4591-86b6-fa2c860e07b4 | industry | PENDING | gdt_vid | wx0hb4yrtlwlnfz201 | - | - | - | 58.34.68.18 |
| 2026-03-04 18:45:20 | e4a3f59b-551e-494d-8840-e0a8b60c252e | 3fed3396-dcaa-431d-97b4-01ea781f1eba | consumer | SUCCESS | - | - | - | - | - | 112.3.206.228 |
| 2026-03-04 18:29:56 | 539737dc-f11d-4620-b738-57b42923a423 | 56fc5a38-2747-42ba-9e8e-5ef409e62fe6 | consumer | SUCCESS | gdt_vid | wx0tqusxr6byj3ne01 | - | - | - | 223.160.210.127 |
| 2026-03-04 17:31:40 | 990364df-eedd-4b66-89bb-f5c749c6376e | 02edbb7a-8307-4fce-87ac-a9354c18168a | consumer | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 17:30:57 | c57daa88-cc6f-4b4e-80ef-a5836044392f | fddc4a64-56b9-43db-aa22-af7310708c2d | consumer | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 16:10:15 | 83a3c8b9-47b2-4275-8dd0-4b344886d7f1 | 61e41e11-6994-450b-9c17-3453563447cd | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 16:09:11 | c901c920-59c5-4f8b-b9e0-b0b5448dd844 | 42307eb0-6234-4b2a-bda6-021f1df0b1ff | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 16:01:36 | 7cca27f7-9713-4a3f-b580-b6bf89a2108c | e841dfbe-00f4-4c1f-ac86-5f00a5823170 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:54:15 | 0921c8fa-78dd-4217-8fc7-97128d48e6fc | 36a89b63-0be5-4799-879c-fa610e94cb67 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:52:40 | 9d55d27c-d394-4dc0-bb35-89188a5d1a52 | 070a2d4d-6fdf-4e31-aba5-525235abde4a | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:51:42 | 74c65509-03cc-4eae-a343-423bb909a5f0 | 4a1345fb-9e68-4ac3-9671-bd1047c17787 | industry | FAILED | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:50:44 | fe87d88f-1f3f-4903-a32f-36642f3470ff | e8c70322-c79e-429c-82a0-3a6a5aafd606 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:44:48 | 2fd712ef-1c69-41a5-9397-562180cbff8a | 53ff4052-2924-454b-a98d-6813d853e827 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:42:03 | 0b914966-fd68-441e-ae8c-c33bff7f0003 | fbc64cff-0397-47c5-805c-3da76d0453a8 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 15:10:48 | 912a5432-21be-48b8-80f3-d7077c58af84 | 0e0a86f6-b1c6-4ff4-b968-490781121728 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 13:55:14 | 01ebd613-a10e-4c2a-8749-b1a17b7e93b3 | 12ae3050-917b-4be4-874c-ef7feed949a3 | industry | SUCCESS | - | - | - | - | - | 219.144.252.106 |
| 2026-03-04 13:21:24 | d3005814-685c-4bec-bc2f-68e0e54d0ff2 | cd6ab845-df67-4e8c-97fc-558b2027adfb | industry | SUCCESS | - | - | - | - | - | 36.21.196.231 |
| 2026-03-04 11:14:08 | 0eac4aae-5705-4fb7-b8c3-c8eb4792fc9d | 33259078-be0f-4eee-8856-c6ae9f902511 | consumer | SUCCESS | - | - | - | - | - | ::ffff:172.21.0.1 |
| 2026-03-04 11:08:58 | 4aaff96f-c85b-4445-a571-502ff0f44e54 | 5656c5fd-079c-4ec5-b594-eefd3a2d148e | consumer | SUCCESS | - | - | - | - | - | 125.69.0.24 |
| 2026-03-04 11:08:20 | ef9f305f-e0e2-46dc-a437-7743734c127f | f794358d-d841-4412-a513-b2fdaa685283 | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
| 2026-03-04 10:51:39 | 901d9dea-b6e3-4f18-aca2-f426bed1d6d4 | a17d9809-4744-45d3-b56e-46b21e7c135a | industry | SUCCESS | - | - | - | - | - | 58.34.68.18 |
