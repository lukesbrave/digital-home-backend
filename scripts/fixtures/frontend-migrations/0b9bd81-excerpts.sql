-- Excerpts of lukesbrave/digital-home-frontend supabase/migrations at 0b9bd81:
-- every create table line of 001-010 and the two create policy statements of 011,
-- each under the file it comes from. scripts/test-upgrade.mjs reads markers from these.

-- file: 001_visitors.sql
create table visitors (

-- file: 002_content_objects.sql
create table seo_meta (
create table content_objects (

-- file: 003_offers.sql
create table offers (

-- file: 004_leads_analytics.sql
create table leads (
create table analytics_events (

-- file: 005_entities.sql
create table entities (
create table entity_relationships (

-- file: 006_personalization_rules.sql
create table personalization_rules (

-- file: 007_email_system.sql
create table email_sequences (
create table email_sends (
create table email_events (

-- file: 008_conversations.sql
create table conversations (
create table messages (

-- file: 009_media_agent_logs.sql
create table media (
create table agent_logs (

-- file: 010_content_calendar.sql
create table content_calendar (

-- file: 011_security_policies.sql
create policy "Public read published content"
  on content_objects
  for select
  to anon, authenticated
  using (status = 'published');
create policy "Public read active offers"
  on offers
  for select
  to anon, authenticated
  using (status = 'active');
