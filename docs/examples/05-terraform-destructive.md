# Example: Terraform Destructive Plan

**Preset:** `infra-risk`
**Case ID:** `tf-plan-destroy`
**Source type:** `synthetic-derived`

## Before

```text
Terraform used the selected providers to generate the following execution plan.
Resource actions are indicated with the following symbols:
  + create
  ~ update in-place
  - destroy

Terraform will perform the following actions:

  # aws_s3_bucket.uploads will be destroyed
  - resource "aws_s3_bucket" "uploads" {
      - bucket = "myapp-uploads-prod" -> null
    }

  # aws_rds_instance.primary will be destroyed
  - resource "aws_rds_instance" "primary" {
      - identifier = "myapp-db-prod" -> null
    }

Plan: 1 to add, 1 to change, 2 to destroy.
```

## After

```text
{
  "verdict": "fail",
  "reason": "Destructive or clearly risky infrastructure change signals are present.",
  "evidence": [
    "Plan: 1 to add, 1 to change, 2 to destroy.",
    "# aws_s3_bucket.uploads will be destroyed",
    "# aws_rds_instance.primary will be destroyed",
    "- destroy"
  ],
  "destroy_count": 2,
  "destroy_targets": [
    "aws_s3_bucket.uploads",
    "aws_rds_instance.primary"
  ],
  "blockers": []
}
```

## Impact

- Raw: `684` chars / `175` tokens
- Reduced: `426` chars / `119` tokens
- Reduction: `32%`

## Related Files

- Benchmark raw input: [benchmarks/cases/infra-risk/tf-plan-destroy.raw.txt](../../benchmarks/cases/infra-risk/tf-plan-destroy.raw.txt)
- Companion raw log: [examples/infra-risk/terraform-destructive-plan-full.raw.txt](../../examples/infra-risk/terraform-destructive-plan-full.raw.txt)
- Companion reduced output: [examples/infra-risk/terraform-destructive-plan-full.reduced.txt](../../examples/infra-risk/terraform-destructive-plan-full.reduced.txt)
