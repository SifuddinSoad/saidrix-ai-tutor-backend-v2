# Data Engineer

## Overview
A Data Engineer designs, builds, and maintains the pipelines and infrastructure that move and transform data so it is reliable, timely, and queryable. Day-to-day work involves writing ETL/ELT jobs, modeling data warehouses, orchestrating workflows, and ensuring data quality, lineage, and cost efficiency. Data engineers are the backbone that analysts, data scientists, and ML/AI systems depend on, which keeps the role consistently in demand.

## Required Skills
- **SQL & data modeling** — strong SQL plus star/snowflake schemas and normalization
- **Python** — pipeline code (often Scala/Java in big-data shops)
- **Batch & streaming processing** — Spark, Kafka
- **Workflow orchestration** — Airflow (or Dagster/Prefect)
- **Cloud data platforms** — Snowflake, BigQuery, Redshift, Databricks
- **Transformation tooling** — dbt for ELT modeling
- **Warehousing & lakehouse architecture** — OLTP vs. OLAP, lake/lakehouse design
- **Engineering practices** — CI/CD, containerization, IaC basics, data quality & observability

## Sub-roles / Specializations
- Analytics Engineer (dbt / modeling focus)
- Streaming / Real-time Data Engineer
- Platform / Infrastructure Data Engineer
- Cloud Data Engineer (AWS / GCP / Azure)
- DataOps / Reliability Engineer
- Big Data Engineer (Spark / Hadoop ecosystems)

## Salary Trend
US (USD): entry ~$100k; mid ~$135k–$155k; senior ~$180k–$230k+. India: typically ₹7–22 LPA depending on city and platform depth. 2025–26 demand: strong and resilient — every AI/ML and analytics initiative requires solid pipelines, so data engineering is among the most consistently in-demand data roles, with lakehouse and streaming skills especially valued.

## Learning Roadmap
**Beginner:** Advanced SQL; Python scripting; Linux/CLI basics; relational database fundamentals; how a data warehouse differs from an OLTP database.
**Intermediate:** Build ELT pipelines with dbt; orchestrate with Airflow; learn a cloud warehouse (BigQuery/Snowflake); dimensional data modeling; batch processing with Spark.
**Advanced:** Streaming with Kafka / Spark Structured Streaming; lakehouse architecture; data quality and observability frameworks; cost and performance optimization; infrastructure-as-code.

## Learning Resources
- DataTalksClub Data Engineering Zoomcamp — free course — https://github.com/DataTalksClub/data-engineering-zoomcamp
- dbt Learn — free courses — https://learn.getdbt.com/
- Apache Airflow Documentation — docs — https://airflow.apache.org/docs/
- Apache Spark Documentation — docs — https://spark.apache.org/docs/latest/
- Google Cloud BigQuery Documentation — docs — https://cloud.google.com/bigquery/docs
- Snowflake Documentation — docs — https://docs.snowflake.com/
- Apache Kafka Documentation — docs — https://kafka.apache.org/documentation/
- The Data Engineering Cookbook — free book/repo — https://github.com/andkret/Cookbook

## Notes for Course Generation
Structure the course as a progressively built data platform: raw source → ingestion → warehouse → dbt transformations → orchestrated, tested, monitored pipeline. Prerequisites are solid SQL and basic Python. Emphasize reliability and data-modeling decisions (idempotency, incremental loads, schema design) over tool syntax, and include a capstone where learners ship an end-to-end orchestrated pipeline with tests and a streaming extension.
