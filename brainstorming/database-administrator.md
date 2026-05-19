# Database Administrator

## Overview
A Database Administrator (DBA) designs, deploys, secures, and maintains database systems so applications have fast, reliable, and durable access to data. Responsibilities include schema and index design, performance tuning, backup and recovery, replication and high availability, security and access control, and capacity planning. DBAs work across relational engines (PostgreSQL, MySQL, SQL Server, Oracle) and increasingly with managed cloud databases. The role spans operational duties (uptime, backups, patching) and engineering work (query optimization, partitioning, replication), and overlaps with data engineering and platform/SRE teams.

## Required Skills
- Strong SQL and relational data modeling (normalization, constraints, transactions)
- Deep knowledge of at least one engine: PostgreSQL, MySQL, or SQL Server
- Indexing strategy and query/performance tuning (execution plans, statistics)
- Backup, restore, and point-in-time recovery design
- Replication, clustering, and high availability / failover
- Database security: access control, encryption, auditing, compliance
- Capacity planning, monitoring, and maintenance automation
- Linux/Windows administration and scripting (Bash/PowerShell, Python)
- Managed cloud databases (AWS RDS/Aurora, Azure SQL, Cloud SQL)

## Sub-roles / Specializations
- PostgreSQL / MySQL / SQL Server Specialist DBA
- Performance / Tuning DBA
- Cloud Database Administrator (RDS/Aurora, Azure SQL, Cloud SQL)
- Reliability / HA & Replication DBA
- Database Security & Compliance DBA
- Database Reliability Engineer (DBRE, automation-focused)

## Salary Trend
US (USD, base): entry ~$80,000; mid ~$105,000-$130,000; senior ~$140,000-$180,000+ (lead/architect and specialized cloud roles higher). India note: roughly INR 5-20 LPA depending on experience, engine specialization, and employer tier. 2025-26 demand: stable, shifting toward cloud and managed databases and the Database Reliability Engineer model; engineers who combine deep tuning skills with cloud, automation, and HA experience are most in demand.

## Learning Roadmap
**Beginner:** Learn SQL thoroughly (queries, joins, aggregation, transactions); understand relational modeling and normalization; install and operate one engine (PostgreSQL recommended).
**Intermediate:** Learn indexing and read execution plans to tune queries; set up backups and point-in-time recovery; configure replication and basic high availability; add monitoring and routine maintenance.
**Advanced:** Design partitioning, sharding, and multi-node HA/failover; implement security, encryption, and auditing for compliance; automate operations and run managed cloud databases at scale; capacity-plan and lead incident recovery.

## Learning Resources
- PostgreSQL Documentation — official docs — https://www.postgresql.org/docs/
- Use The Index, Luke — tutorial — https://use-the-index-luke.com/
- MySQL Documentation — official docs — https://dev.mysql.com/doc/
- Microsoft SQL Learn — courses / docs — https://learn.microsoft.com/en-us/sql/
- Mode SQL Tutorial — interactive tutorial — https://mode.com/sql-tutorial/
- AWS RDS Documentation — official docs — https://docs.aws.amazon.com/rds/
- PostgreSQL Tutorial — tutorial — https://www.postgresqltutorial.com/
- PostgreSQL DBA Roadmap — interactive roadmap — https://roadmap.sh/postgresql-dba

## Notes for Course Generation
Build the course on one primary engine (PostgreSQL recommended) with modules for SQL and modeling, indexing and query tuning, backup/recovery, replication and HA, security/compliance, and managed cloud databases. Prerequisites are basic SQL and command-line familiarity; capstone projects should include tuning a slow workload and configuring a replicated, backed-up, monitored database with a tested recovery procedure. Reference certifications such as Microsoft Azure Database Administrator Associate (DP-300), Oracle Database Administrator, and AWS Database Specialty.
