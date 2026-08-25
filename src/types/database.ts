export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      studio_sources: {
        Row: {
          id: string;
          url: string;
          platform: "youtube" | "instagram" | "tiktok" | "facebook_ads" | "website" | "article" | "upload";
          kind: "own" | "competitor" | "inspiration";
          status: "pending" | "ingesting" | "ready" | "failed";
          title: string | null;
          author: string | null;
          seconds: number | null;
          published_at: string | null;
          transcript: string | null;
          analysis: Json | null;
          engagement: Json | null;
          notes: string | null;
          thumbnail: string | null;
          mirrored_from: string | null;
          mirror_key: string | null;
          added_by: string;
          added_at: string;
          refreshed_at: string;
        };
        Insert: {
          id?: string;
          url: string;
          platform: string;
          kind?: string;
          status?: string;
          title?: string | null;
          author?: string | null;
          seconds?: number | null;
          published_at?: string | null;
          transcript?: string | null;
          analysis?: Json | null;
          engagement?: Json | null;
          notes?: string | null;
          thumbnail?: string | null;
          mirrored_from?: string | null;
          mirror_key?: string | null;
          added_by?: string;
          refreshed_at?: string;
        };
        Update: {
          url?: string;
          platform?: string;
          kind?: string;
          status?: string;
          title?: string | null;
          author?: string | null;
          seconds?: number | null;
          published_at?: string | null;
          transcript?: string | null;
          analysis?: Json | null;
          engagement?: Json | null;
          notes?: string | null;
          thumbnail?: string | null;
          refreshed_at?: string;
        };
        Relationships: [];
      };
      studio_ingest_jobs: {
        Row: {
          id: string;
          source_id: string;
          status: "queued" | "claimed" | "fetching" | "transcribing" | "analyzing" | "ready" | "failed";
          stage: string;
          progress: number;
          runner_id: string | null;
          error: string | null;
          attempts: number;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source_id: string;
          status?: string;
          stage?: string;
          progress?: number;
          runner_id?: string | null;
          error?: string | null;
          attempts?: number;
          claimed_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: string;
          stage?: string;
          progress?: number;
          runner_id?: string | null;
          error?: string | null;
          attempts?: number;
          claimed_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      studio_boards: {
        Row: {
          id: string;
          name: string;
          template_key: string | null;
          viewport: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { id?: string; name: string; template_key?: string | null; viewport?: Json | null };
        Update: { name?: string; template_key?: string | null; viewport?: Json | null };
        Relationships: [];
      };
      studio_nodes: {
        Row: {
          id: string;
          board_id: string;
          kind: "source" | "desk" | "note" | "sop" | "group" | "output" | "creative";
          parent_id: string | null;
          position: Json;
          data: Json;
          source_id: string | null;
          desk_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          board_id: string;
          kind: string;
          parent_id?: string | null;
          position?: Json;
          data?: Json;
          source_id?: string | null;
          desk_id?: string | null;
        };
        Update: {
          kind?: string;
          parent_id?: string | null;
          position?: Json;
          data?: Json;
          source_id?: string | null;
          desk_id?: string | null;
        };
        Relationships: [];
      };
      studio_edges: {
        Row: { id: string; board_id: string; from_node: string; to_node: string; created_at: string };
        Insert: { id?: string; board_id: string; from_node: string; to_node: string };
        Update: { from_node?: string; to_node?: string };
        Relationships: [];
      };
      studio_gen_jobs: {
        Row: {
          id: string;
          board_id: string;
          desk_node_id: string | null;
          prompt: string;
          model: string;
          asset_type: string;
          image_size: Json;
          reference_urls: Json;
          count: number;
          status: "queued" | "claimed" | "generating" | "ready" | "failed";
          stage: string;
          results: Json | null;
          error: string | null;
          runner_id: string | null;
          claimed_at: string | null;
          completed_at: string | null;
          dismissed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          board_id: string;
          desk_node_id?: string | null;
          prompt: string;
          model?: string;
          asset_type?: string;
          image_size?: Json;
          reference_urls?: Json;
          count?: number;
          status?: string;
          stage?: string;
        };
        Update: {
          status?: string;
          stage?: string;
          asset_type?: string;
          image_size?: Json;
          results?: Json | null;
          error?: string | null;
          runner_id?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          dismissed?: boolean;
        };
        Relationships: [];
      };
      studio_desks: {
        Row: {
          id: string;
          name: string;
          persona: "none" | "content-manager" | "beacon";
          sop: string | null;
          model: string;
          max_context_tokens: number;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          persona?: string;
          sop?: string | null;
          model?: string;
          max_context_tokens?: number;
          settings?: Json;
        };
        Update: {
          name?: string;
          persona?: string;
          sop?: string | null;
          model?: string;
          max_context_tokens?: number;
          settings?: Json;
        };
        Relationships: [];
      };
      studio_desk_messages: {
        Row: {
          id: string;
          desk_id: string;
          role: "user" | "assistant";
          content: string;
          meta: Json | null;
          created_at: string;
        };
        Insert: { id?: string; desk_id: string; role: string; content: string; meta?: Json | null; created_at?: string };
        Update: { content?: string; meta?: Json | null };
        Relationships: [];
      };
      voice_profiles: {
        Row: { id: string; version: number; profile: Json; source_count: number; generated_at: string };
        Insert: { id?: string; version: number; profile: Json; source_count?: number };
        Update: { profile?: Json; source_count?: number };
        Relationships: [];
      };
      upgrade_codes: {
        Row: {
          id: string;
          code: string;
          member_email: string | null;
          product: string;
          status: "active" | "revoked";
          created_at: string;
          last_used_at: string | null;
          use_count: number;
        };
        Insert: {
          id?: string;
          code: string;
          member_email?: string | null;
          product?: string;
          status?: string;
        };
        Update: {
          member_email?: string | null;
          status?: string;
          last_used_at?: string | null;
          use_count?: number;
        };
        Relationships: [];
      };
      video_transcripts: {
        Row: {
          video_id: string;
          title: string | null;
          published_at: string | null;
          seconds: number | null;
          source: "manual" | "asr" | "timedtext";
          language: string | null;
          transcript: string;
          word_count: number;
          fetched_at: string;
          updated_at: string;
        };
        Insert: {
          video_id: string;
          title?: string | null;
          published_at?: string | null;
          seconds?: number | null;
          source: "manual" | "asr" | "timedtext";
          language?: string | null;
          transcript: string;
          word_count?: number;
          fetched_at?: string;
          updated_at?: string;
        };
        Update: {
          video_id?: string;
          title?: string | null;
          published_at?: string | null;
          seconds?: number | null;
          source?: "manual" | "asr" | "timedtext";
          language?: string | null;
          transcript?: string;
          word_count?: number;
          fetched_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      visitors: {
        Row: {
          id: string;
          anonymous_id: string;
          first_source: string | null;
          first_medium: string | null;
          first_campaign: string | null;
          first_referrer: string | null;
          first_referrer_domain: string | null;
          is_ai_traffic: boolean;
          ai_referrer_source: string | null;
          latest_source: string | null;
          latest_medium: string | null;
          latest_campaign: string | null;
          latest_referrer: string | null;
          segment: string | null;
          visit_count: number;
          first_seen_at: string;
          last_seen_at: string;
          pages_viewed: string[];
          content_affinities: string[];
          device_type: string | null;
          browser: string | null;
          os: string | null;
          country: string | null;
          city: string | null;
          lead_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          anonymous_id: string;
          first_source?: string | null;
          first_medium?: string | null;
          first_campaign?: string | null;
          first_referrer?: string | null;
          first_referrer_domain?: string | null;
          is_ai_traffic?: boolean;
          ai_referrer_source?: string | null;
          latest_source?: string | null;
          latest_medium?: string | null;
          latest_campaign?: string | null;
          latest_referrer?: string | null;
          segment?: string | null;
          visit_count?: number;
          first_seen_at?: string;
          last_seen_at?: string;
          pages_viewed?: string[];
          content_affinities?: string[];
          device_type?: string | null;
          browser?: string | null;
          os?: string | null;
          country?: string | null;
          city?: string | null;
          lead_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          anonymous_id?: string;
          first_source?: string | null;
          first_medium?: string | null;
          first_campaign?: string | null;
          first_referrer?: string | null;
          first_referrer_domain?: string | null;
          is_ai_traffic?: boolean;
          ai_referrer_source?: string | null;
          latest_source?: string | null;
          latest_medium?: string | null;
          latest_campaign?: string | null;
          latest_referrer?: string | null;
          segment?: string | null;
          visit_count?: number;
          first_seen_at?: string;
          last_seen_at?: string;
          pages_viewed?: string[];
          content_affinities?: string[];
          device_type?: string | null;
          browser?: string | null;
          os?: string | null;
          country?: string | null;
          city?: string | null;
          lead_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      content_objects: {
        Row: {
          id: string;
          slug: string;
          title: string;
          subtitle: string | null;
          content_type: "article" | "case_study" | "video" | "guide" | "landing_page" | "snippet";
          body: string | null;
          excerpt: string | null;
          semantic_tags: string[];
          associated_offers: string[];
          target_segments: string[];
          seo_meta_id: string | null;
          featured_image_url: string | null;
          featured_video_url: string | null;
          view_count: number;
          unique_visitors: number;
          avg_time_on_page: number;
          conversion_count: number;
          engagement_score: number;
          status: "draft" | "published" | "archived";
          created_by: "human" | "content_agent" | "seo_agent";
          author_name: string;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          subtitle?: string | null;
          content_type?: "article" | "case_study" | "video" | "guide" | "landing_page" | "snippet";
          body?: string | null;
          excerpt?: string | null;
          semantic_tags?: string[];
          associated_offers?: string[];
          target_segments?: string[];
          seo_meta_id?: string | null;
          featured_image_url?: string | null;
          featured_video_url?: string | null;
          view_count?: number;
          unique_visitors?: number;
          avg_time_on_page?: number;
          conversion_count?: number;
          engagement_score?: number;
          status?: "draft" | "published" | "archived";
          created_by?: "human" | "content_agent" | "seo_agent";
          author_name?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          title?: string;
          subtitle?: string | null;
          content_type?: "article" | "case_study" | "video" | "guide" | "landing_page" | "snippet";
          body?: string | null;
          excerpt?: string | null;
          semantic_tags?: string[];
          associated_offers?: string[];
          target_segments?: string[];
          seo_meta_id?: string | null;
          featured_image_url?: string | null;
          featured_video_url?: string | null;
          view_count?: number;
          unique_visitors?: number;
          avg_time_on_page?: number;
          conversion_count?: number;
          engagement_score?: number;
          status?: "draft" | "published" | "archived";
          created_by?: "human" | "content_agent" | "seo_agent";
          author_name?: string;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      carousel_jobs: {
        Row: {
          id: string;
          requested_by: string;
          request: string | null;
          source_article_id: string | null;
          source_title: string | null;
          source_slug: string | null;
          status: "queued" | "running" | "writing" | "rendering" | "uploading" | "ready" | "revision_queued" | "revising" | "approved" | "rejected" | "failed";
          stage: string;
          progress: number;
          revision: number;
          executor: "factory" | "employee";
          result: Json | null;
          run_dir: string | null;
          post_id: string | null;
          action_id: string | null;
          error: string | null;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requested_by?: string;
          request?: string | null;
          source_article_id?: string | null;
          source_title?: string | null;
          source_slug?: string | null;
          status?: "queued" | "running" | "writing" | "rendering" | "uploading" | "ready" | "revision_queued" | "revising" | "approved" | "rejected" | "failed";
          stage?: string;
          progress?: number;
          revision?: number;
          executor?: "factory" | "employee";
          result?: Json | null;
          run_dir?: string | null;
          post_id?: string | null;
          action_id?: string | null;
          error?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          requested_by?: string;
          request?: string | null;
          source_article_id?: string | null;
          source_title?: string | null;
          source_slug?: string | null;
          status?: "queued" | "running" | "writing" | "rendering" | "uploading" | "ready" | "revision_queued" | "revising" | "approved" | "rejected" | "failed";
          stage?: string;
          progress?: number;
          revision?: number;
          executor?: "factory" | "employee";
          result?: Json | null;
          run_dir?: string | null;
          post_id?: string | null;
          action_id?: string | null;
          error?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      carousel_revisions: {
        Row: {
          id: string;
          carousel_job_id: string;
          revision_number: number;
          requested_by: string;
          feedback: string;
          slide_numbers: number[];
          status: "queued" | "claimed" | "revising" | "rendering" | "uploading" | "ready" | "failed" | "cancelled";
          stage: string;
          progress: number;
          base_run_dir: string;
          post_id: string | null;
          action_id: string | null;
          proposed_slot: string | null;
          error: string | null;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          carousel_job_id: string;
          revision_number: number;
          requested_by?: string;
          feedback: string;
          slide_numbers?: number[];
          status?: "queued" | "claimed" | "revising" | "rendering" | "uploading" | "ready" | "failed" | "cancelled";
          stage?: string;
          progress?: number;
          base_run_dir: string;
          post_id?: string | null;
          action_id?: string | null;
          proposed_slot?: string | null;
          error?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          carousel_job_id?: string;
          revision_number?: number;
          requested_by?: string;
          feedback?: string;
          slide_numbers?: number[];
          status?: "queued" | "claimed" | "revising" | "rendering" | "uploading" | "ready" | "failed" | "cancelled";
          stage?: string;
          progress?: number;
          base_run_dir?: string;
          post_id?: string | null;
          action_id?: string | null;
          proposed_slot?: string | null;
          error?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "carousel_revisions_carousel_job_id_fkey";
            columns: ["carousel_job_id"];
            isOneToOne: false;
            referencedRelation: "carousel_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      seo_meta: {
        Row: {
          id: string;
          title: string | null;
          description: string | null;
          canonical_url: string | null;
          og_image_url: string | null;
          schema_type: string;
          breadcrumb_path: Json | null;
          target_keyword: string | null;
          secondary_keywords: string[];
          keyword_cluster: string | null;
          current_rank: number | null;
          impressions_30d: number;
          clicks_30d: number;
          ctr_30d: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title?: string | null;
          description?: string | null;
          canonical_url?: string | null;
          og_image_url?: string | null;
          schema_type?: string;
          breadcrumb_path?: Json | null;
          target_keyword?: string | null;
          secondary_keywords?: string[];
          keyword_cluster?: string | null;
          current_rank?: number | null;
          impressions_30d?: number;
          clicks_30d?: number;
          ctr_30d?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string | null;
          description?: string | null;
          canonical_url?: string | null;
          og_image_url?: string | null;
          schema_type?: string;
          breadcrumb_path?: Json | null;
          target_keyword?: string | null;
          secondary_keywords?: string[];
          keyword_cluster?: string | null;
          current_rank?: number | null;
          impressions_30d?: number;
          clicks_30d?: number;
          ctr_30d?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          id: string;
          slug: string;
          name: string;
          tagline: string | null;
          description: string | null;
          price_display: string | null;
          price_cents: number | null;
          currency: string;
          billing_cycle: string | null;
          who_its_for: string | null;
          target_segments: string[];
          position_in_ladder: number | null;
          benefits: string[];
          cta_text: string | null;
          cta_url: string | null;
          featured_image_url: string | null;
          status: "active" | "paused" | "archived";
          view_count: number;
          click_count: number;
          conversion_count: number;
          conversion_rate: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          tagline?: string | null;
          description?: string | null;
          price_display?: string | null;
          price_cents?: number | null;
          currency?: string;
          billing_cycle?: string | null;
          who_its_for?: string | null;
          target_segments?: string[];
          position_in_ladder?: number | null;
          benefits?: string[];
          cta_text?: string | null;
          cta_url?: string | null;
          featured_image_url?: string | null;
          status?: "active" | "paused" | "archived";
          view_count?: number;
          click_count?: number;
          conversion_count?: number;
          conversion_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          tagline?: string | null;
          description?: string | null;
          price_display?: string | null;
          price_cents?: number | null;
          currency?: string;
          billing_cycle?: string | null;
          who_its_for?: string | null;
          target_segments?: string[];
          position_in_ladder?: number | null;
          benefits?: string[];
          cta_text?: string | null;
          cta_url?: string | null;
          featured_image_url?: string | null;
          status?: "active" | "paused" | "archived";
          view_count?: number;
          click_count?: number;
          conversion_count?: number;
          conversion_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          visitor_id: string | null;
          source: string | null;
          capture_page: string | null;
          status: "new" | "engaged" | "qualified" | "converted" | "lost";
          score: number;
          tags: string[];
          interested_offers: string[];
          phone: string | null;
          company: string | null;
          custom: Json;
          email_status: "subscribed" | "unsubscribed" | "bounced" | "complained";
          unsubscribe_token: string;
          timezone: string | null;
          last_activity_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          visitor_id?: string | null;
          source?: string | null;
          capture_page?: string | null;
          status?: "new" | "engaged" | "qualified" | "converted" | "lost";
          score?: number;
          tags?: string[];
          interested_offers?: string[];
          phone?: string | null;
          company?: string | null;
          custom?: Json;
          email_status?: "subscribed" | "unsubscribed" | "bounced" | "complained";
          unsubscribe_token?: string;
          timezone?: string | null;
          last_activity_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          visitor_id?: string | null;
          source?: string | null;
          capture_page?: string | null;
          status?: "new" | "engaged" | "qualified" | "converted" | "lost";
          score?: number;
          tags?: string[];
          interested_offers?: string[];
          phone?: string | null;
          company?: string | null;
          custom?: Json;
          email_status?: "subscribed" | "unsubscribed" | "bounced" | "complained";
          unsubscribe_token?: string;
          timezone?: string | null;
          last_activity_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          visitor_id: string | null;
          anonymous_id: string;
          event_type: string;
          event_data: Json;
          page_url: string | null;
          page_slug: string | null;
          referrer: string | null;
          content_id: string | null;
          offer_id: string | null;
          visitor_segment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          visitor_id?: string | null;
          anonymous_id: string;
          event_type: string;
          event_data?: Json;
          page_url?: string | null;
          page_slug?: string | null;
          referrer?: string | null;
          content_id?: string | null;
          offer_id?: string | null;
          visitor_segment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          visitor_id?: string | null;
          anonymous_id?: string;
          event_type?: string;
          event_data?: Json;
          page_url?: string | null;
          page_slug?: string | null;
          referrer?: string | null;
          content_id?: string | null;
          offer_id?: string | null;
          visitor_segment?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      entities: {
        Row: {
          id: string;
          slug: string;
          name: string;
          entity_type: "organization" | "person" | "service" | "product" | "article" | "case_study" | "concept" | "event" | "place" | "thing";
          schema_type: string;
          schema_id: string | null;
          description: string | null;
          url: string | null;
          image_url: string | null;
          image_width: number | null;
          image_height: number | null;
          same_as: string[];
          properties: Json;
          knows_about: Json;
          appears_on_pages: string[];
          managed_by: string;
          last_audited_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          entity_type: "organization" | "person" | "service" | "product" | "article" | "case_study" | "concept" | "event" | "place" | "thing";
          schema_type: string;
          schema_id?: string | null;
          description?: string | null;
          url?: string | null;
          image_url?: string | null;
          image_width?: number | null;
          image_height?: number | null;
          same_as?: string[];
          properties?: Json;
          knows_about?: Json;
          appears_on_pages?: string[];
          managed_by?: string;
          last_audited_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          entity_type?: "organization" | "person" | "service" | "product" | "article" | "case_study" | "concept" | "event" | "place" | "thing";
          schema_type?: string;
          schema_id?: string | null;
          description?: string | null;
          url?: string | null;
          image_url?: string | null;
          image_width?: number | null;
          image_height?: number | null;
          same_as?: string[];
          properties?: Json;
          knows_about?: Json;
          appears_on_pages?: string[];
          managed_by?: string;
          last_audited_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      entity_relationships: {
        Row: {
          id: string;
          subject_id: string;
          predicate: string;
          object_id: string;
          properties: Json;
          weight: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          subject_id: string;
          predicate: string;
          object_id: string;
          properties?: Json;
          weight?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          subject_id?: string;
          predicate?: string;
          object_id?: string;
          properties?: Json;
          weight?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      personalization_rules: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          condition: Json;
          action: Json;
          page_patterns: string[];
          priority: number;
          status: "active" | "paused" | "archived";
          impressions: number;
          conversions: number;
          conversion_rate: number;
          created_by: string;
          last_evaluated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          condition: Json;
          action: Json;
          page_patterns?: string[];
          priority?: number;
          status?: "active" | "paused" | "archived";
          impressions?: number;
          conversions?: number;
          conversion_rate?: number;
          created_by?: string;
          last_evaluated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          condition?: Json;
          action?: Json;
          page_patterns?: string[];
          priority?: number;
          status?: "active" | "paused" | "archived";
          impressions?: number;
          conversions?: number;
          conversion_rate?: number;
          created_by?: string;
          last_evaluated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_sequences: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          trigger_type: string;
          trigger_config: Json;
          steps: Json;
          target_segments: string[];
          status: "active" | "paused" | "archived";
          total_enrolled: number;
          total_completed: number;
          avg_open_rate: number;
          avg_click_rate: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          trigger_type: string;
          trigger_config?: Json;
          steps?: Json;
          target_segments?: string[];
          status?: "active" | "paused" | "archived";
          total_enrolled?: number;
          total_completed?: number;
          avg_open_rate?: number;
          avg_click_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          trigger_type?: string;
          trigger_config?: Json;
          steps?: Json;
          target_segments?: string[];
          status?: "active" | "paused" | "archived";
          total_enrolled?: number;
          total_completed?: number;
          avg_open_rate?: number;
          avg_click_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_sends: {
        Row: {
          id: string;
          lead_id: string;
          email_address: string;
          sequence_id: string | null;
          step_number: number | null;
          subject: string;
          variant: string | null;
          template_id: string | null;
          resend_id: string | null;
          status: "pending" | "sent" | "failed" | "bounced" | "simulated" | "suppressed";
          sent_at: string | null;
          error_message: string | null;
          workflow_id: string | null;
          enrollment_id: string | null;
          email_template_id: string | null;
          body_html: string | null;
          opened_at: string | null;
          clicked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          email_address: string;
          sequence_id?: string | null;
          step_number?: number | null;
          subject: string;
          variant?: string | null;
          template_id?: string | null;
          resend_id?: string | null;
          status?: "pending" | "sent" | "failed" | "bounced" | "simulated" | "suppressed";
          sent_at?: string | null;
          error_message?: string | null;
          workflow_id?: string | null;
          enrollment_id?: string | null;
          email_template_id?: string | null;
          body_html?: string | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          email_address?: string;
          sequence_id?: string | null;
          step_number?: number | null;
          subject?: string;
          variant?: string | null;
          template_id?: string | null;
          resend_id?: string | null;
          status?: "pending" | "sent" | "failed" | "bounced" | "simulated" | "suppressed";
          sent_at?: string | null;
          error_message?: string | null;
          workflow_id?: string | null;
          enrollment_id?: string | null;
          email_template_id?: string | null;
          body_html?: string | null;
          opened_at?: string | null;
          clicked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      email_events: {
        Row: {
          id: string;
          send_id: string;
          lead_id: string;
          event_type: "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed";
          event_data: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          send_id: string;
          lead_id: string;
          event_type: "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed";
          event_data?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          send_id?: string;
          lead_id?: string;
          event_type?: "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed";
          event_data?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          visitor_id: string | null;
          lead_id: string | null;
          channel: "web_chat" | "whatsapp";
          external_id: string | null;
          started_on_page: string | null;
          visitor_segment: string | null;
          context: Json;
          status: "active" | "closed" | "archived";
          message_count: number;
          started_at: string;
          last_message_at: string;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          visitor_id?: string | null;
          lead_id?: string | null;
          channel?: "web_chat" | "whatsapp";
          external_id?: string | null;
          started_on_page?: string | null;
          visitor_segment?: string | null;
          context?: Json;
          status?: "active" | "closed" | "archived";
          message_count?: number;
          started_at?: string;
          last_message_at?: string;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          visitor_id?: string | null;
          lead_id?: string | null;
          channel?: "web_chat" | "whatsapp";
          external_id?: string | null;
          started_on_page?: string | null;
          visitor_segment?: string | null;
          context?: Json;
          status?: "active" | "closed" | "archived";
          message_count?: number;
          started_at?: string;
          last_message_at?: string;
          closed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: "user" | "assistant" | "system";
          content: string;
          token_count: number | null;
          model: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: "user" | "assistant" | "system";
          content: string;
          token_count?: number | null;
          model?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: "user" | "assistant" | "system";
          content?: string;
          token_count?: number | null;
          model?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      media: {
        Row: {
          id: string;
          filename: string;
          mime_type: string;
          file_size: number | null;
          width: number | null;
          height: number | null;
          duration: number | null;
          r2_key: string;
          url: string;
          alt_text: string | null;
          caption: string | null;
          tags: string[];
          used_in_content: string[];
          uploaded_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          filename: string;
          mime_type: string;
          file_size?: number | null;
          width?: number | null;
          height?: number | null;
          duration?: number | null;
          r2_key: string;
          url: string;
          alt_text?: string | null;
          caption?: string | null;
          tags?: string[];
          used_in_content?: string[];
          uploaded_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          filename?: string;
          mime_type?: string;
          file_size?: number | null;
          width?: number | null;
          height?: number | null;
          duration?: number | null;
          r2_key?: string;
          url?: string;
          alt_text?: string | null;
          caption?: string | null;
          tags?: string[];
          used_in_content?: string[];
          uploaded_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      content_calendar: {
        Row: {
          id: string;
          title: string;
          search_query: string | null;
          target_keyword: string | null;
          keyword_cluster: string | null;
          intent_type: "how_to" | "comparison" | "definition" | "informational" | "commercial" | "transactional" | "listicle" | "case_study" | "opinion";
          priority: "high" | "medium" | "low";
          status: "planned" | "approved" | "writing" | "draft" | "published" | "archived";
          pillar_topic: string | null;
          topic_cluster: string | null;
          scheduled_publish_date: string | null;
          content_object_id: string | null;
          seo_meta_id: string | null;
          run_id: string | null;
          created_by: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          search_query?: string | null;
          target_keyword?: string | null;
          keyword_cluster?: string | null;
          intent_type?: "how_to" | "comparison" | "definition" | "informational" | "commercial" | "transactional" | "listicle" | "case_study" | "opinion";
          priority?: "high" | "medium" | "low";
          status?: "planned" | "approved" | "writing" | "draft" | "published" | "archived";
          pillar_topic?: string | null;
          topic_cluster?: string | null;
          scheduled_publish_date?: string | null;
          content_object_id?: string | null;
          seo_meta_id?: string | null;
          run_id?: string | null;
          created_by?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          search_query?: string | null;
          target_keyword?: string | null;
          keyword_cluster?: string | null;
          intent_type?: "how_to" | "comparison" | "definition" | "informational" | "commercial" | "transactional" | "listicle" | "case_study" | "opinion";
          priority?: "high" | "medium" | "low";
          status?: "planned" | "approved" | "writing" | "draft" | "published" | "archived";
          pillar_topic?: string | null;
          topic_cluster?: string | null;
          scheduled_publish_date?: string | null;
          content_object_id?: string | null;
          seo_meta_id?: string | null;
          run_id?: string | null;
          created_by?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_logs: {
        Row: {
          id: string;
          agent: "content_agent" | "seo_agent" | "openclawd" | "analytics_agent" | "email_agent";
          action: string;
          description: string | null;
          status: "started" | "completed" | "failed";
          target_table: string | null;
          target_id: string | null;
          input_data: Json;
          output_data: Json;
          error_message: string | null;
          duration_ms: number | null;
          tokens_used: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          agent: "content_agent" | "seo_agent" | "openclawd" | "analytics_agent" | "email_agent";
          action: string;
          description?: string | null;
          status?: "started" | "completed" | "failed";
          target_table?: string | null;
          target_id?: string | null;
          input_data?: Json;
          output_data?: Json;
          error_message?: string | null;
          duration_ms?: number | null;
          tokens_used?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          agent?: "content_agent" | "seo_agent" | "openclawd" | "analytics_agent" | "email_agent";
          action?: string;
          description?: string | null;
          status?: "started" | "completed" | "failed";
          target_table?: string | null;
          target_id?: string | null;
          input_data?: Json;
          output_data?: Json;
          error_message?: string | null;
          duration_ms?: number | null;
          tokens_used?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_runs: {
        Row: {
          id: string;
          trigger: "chat" | "tick" | "hermes";
          status: "running" | "completed" | "failed";
          summary: string | null;
          report_md: string | null;
          tool_calls: Json;
          tokens_used: number | null;
          error: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          trigger?: "chat" | "tick" | "hermes";
          status?: "running" | "completed" | "failed";
          summary?: string | null;
          report_md?: string | null;
          tool_calls?: Json;
          tokens_used?: number | null;
          error?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          trigger?: "chat" | "tick" | "hermes";
          status?: "running" | "completed" | "failed";
          summary?: string | null;
          report_md?: string | null;
          tool_calls?: Json;
          tokens_used?: number | null;
          error?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      agent_threads: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agent_messages: {
        Row: {
          id: string;
          thread_id: string;
          role: "user" | "assistant";
          content: string;
          run_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          role: "user" | "assistant";
          content: string;
          run_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          role?: "user" | "assistant";
          content?: string;
          run_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "agent_threads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_messages_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_actions: {
        Row: {
          id: string;
          run_id: string | null;
          type: "email" | "publish" | "workflow" | "other";
          title: string;
          summary: string | null;
          payload: Json;
          status: "proposed" | "approved" | "rejected" | "executed" | "failed";
          result: Json | null;
          created_at: string;
          decided_at: string | null;
          executed_at: string | null;
        };
        Insert: {
          id?: string;
          run_id?: string | null;
          type: "email" | "publish" | "workflow" | "other";
          title: string;
          summary?: string | null;
          payload?: Json;
          status?: "proposed" | "approved" | "rejected" | "executed" | "failed";
          result?: Json | null;
          created_at?: string;
          decided_at?: string | null;
          executed_at?: string | null;
        };
        Update: {
          id?: string;
          run_id?: string | null;
          type?: "email" | "publish" | "workflow" | "other";
          title?: string;
          summary?: string | null;
          payload?: Json;
          status?: "proposed" | "approved" | "rejected" | "executed" | "failed";
          result?: Json | null;
          created_at?: string;
          decided_at?: string | null;
          executed_at?: string | null;
        };
        Relationships: [];
      };
      social_accounts: {
        Row: {
          id: string;
          platform: "instagram" | "facebook" | "youtube";
          external_id: string;
          name: string;
          username: string | null;
          access_token: string | null;
          refresh_token: string | null;
          token_expires_at: string | null;
          status: "active" | "error" | "disconnected";
          metadata: Json;
          connected_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          platform: "instagram" | "facebook" | "youtube";
          external_id: string;
          name: string;
          username?: string | null;
          access_token?: string | null;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          status?: "active" | "error" | "disconnected";
          metadata?: Json;
          connected_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          platform?: "instagram" | "facebook" | "youtube";
          external_id?: string;
          name?: string;
          username?: string | null;
          access_token?: string | null;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          status?: "active" | "error" | "disconnected";
          metadata?: Json;
          connected_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      social_posts: {
        Row: {
          id: string;
          title: string | null;
          caption: string;
          video_path: string | null;
          video_url: string | null;
          thumbnail_url: string | null;
          post_type: "video" | "carousel";
          status: "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "canceled";
          scheduled_at: string | null;
          published_at: string | null;
          created_by: string;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title?: string | null;
          caption?: string;
          video_path?: string | null;
          video_url?: string | null;
          thumbnail_url?: string | null;
          post_type?: "video" | "carousel";
          status?: "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "canceled";
          scheduled_at?: string | null;
          published_at?: string | null;
          created_by?: string;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string | null;
          caption?: string;
          video_path?: string | null;
          video_url?: string | null;
          thumbnail_url?: string | null;
          post_type?: "video" | "carousel";
          status?: "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "canceled";
          scheduled_at?: string | null;
          published_at?: string | null;
          created_by?: string;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      social_post_media: {
        Row: {
          id: string;
          post_id: string;
          position: number;
          kind: "image" | "video";
          path: string | null;
          url: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          position?: number;
          kind?: "image" | "video";
          path?: string | null;
          url: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          position?: number;
          kind?: "image" | "video";
          path?: string | null;
          url?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_media_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_post_targets: {
        Row: {
          id: string;
          post_id: string;
          account_id: string;
          platform: "instagram" | "facebook" | "youtube";
          status: "pending" | "publishing" | "processing" | "published" | "failed" | "skipped";
          caption_override: string | null;
          external_id: string | null;
          external_url: string | null;
          platform_ref: Json;
          error: string | null;
          attempts: number;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          account_id: string;
          platform: "instagram" | "facebook" | "youtube";
          status?: "pending" | "publishing" | "processing" | "published" | "failed" | "skipped";
          caption_override?: string | null;
          external_id?: string | null;
          external_url?: string | null;
          platform_ref?: Json;
          error?: string | null;
          attempts?: number;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          account_id?: string;
          platform?: "instagram" | "facebook" | "youtube";
          status?: "pending" | "publishing" | "processing" | "published" | "failed" | "skipped";
          caption_override?: string | null;
          external_id?: string | null;
          external_url?: string | null;
          platform_ref?: Json;
          error?: string | null;
          attempts?: number;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_post_targets_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "social_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "social_post_targets_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      social_metrics: {
        Row: {
          id: string;
          target_id: string;
          captured_at: string;
          views: number;
          likes: number;
          comments: number;
          shares: number;
          saves: number;
          reach: number;
          raw: Json;
        };
        Insert: {
          id?: string;
          target_id: string;
          captured_at?: string;
          views?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          saves?: number;
          reach?: number;
          raw?: Json;
        };
        Update: {
          id?: string;
          target_id?: string;
          captured_at?: string;
          views?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          saves?: number;
          reach?: number;
          raw?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "social_metrics_target_id_fkey";
            columns: ["target_id"];
            isOneToOne: false;
            referencedRelation: "social_post_targets";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_custom_fields: {
        Row: {
          id: string;
          key: string;
          label: string;
          field_type: string;
          options: Json;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          label: string;
          field_type?: string;
          options?: Json;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          label?: string;
          field_type?: string;
          options?: Json;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      crm_tags: {
        Row: {
          id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      pipelines: {
        Row: {
          id: string;
          name: string;
          is_default: boolean;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_default?: boolean;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          is_default?: boolean;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      pipeline_stages: {
        Row: {
          id: string;
          pipeline_id: string;
          name: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          pipeline_id: string;
          name: string;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          pipeline_id?: string;
          name?: string;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      opportunities: {
        Row: {
          id: string;
          lead_id: string;
          pipeline_id: string;
          stage_id: string;
          name: string;
          value_cents: number;
          currency: string;
          status: "open" | "won" | "lost";
          position: number;
          won_at: string | null;
          lost_at: string | null;
          lost_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          pipeline_id: string;
          stage_id: string;
          name: string;
          value_cents?: number;
          currency?: string;
          status?: "open" | "won" | "lost";
          position?: number;
          won_at?: string | null;
          lost_at?: string | null;
          lost_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          pipeline_id?: string;
          stage_id?: string;
          name?: string;
          value_cents?: number;
          currency?: string;
          status?: "open" | "won" | "lost";
          position?: number;
          won_at?: string | null;
          lost_at?: string | null;
          lost_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lead_activities: {
        Row: {
          id: string;
          lead_id: string;
          activity_type: string;
          title: string;
          body: string | null;
          data: Json;
          actor: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          activity_type: string;
          title: string;
          body?: string | null;
          data?: Json;
          actor?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          activity_type?: string;
          title?: string;
          body?: string | null;
          data?: Json;
          actor?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      email_templates: {
        Row: {
          id: string;
          name: string;
          subject: string;
          subject_b: string | null;
          preheader: string | null;
          body_md: string;
          category: string | null;
          ai_generated: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          subject: string;
          subject_b?: string | null;
          preheader?: string | null;
          body_md: string;
          category?: string | null;
          ai_generated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          subject?: string;
          subject_b?: string | null;
          preheader?: string | null;
          body_md?: string;
          category?: string | null;
          ai_generated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workflows: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          status: "draft" | "active" | "paused" | "archived";
          trigger_type: string;
          trigger_config: Json;
          steps: Json;
          allow_reenrollment: boolean;
          ai_brief: Json | null;
          enrolled_count: number;
          completed_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          status?: "draft" | "active" | "paused" | "archived";
          trigger_type?: string;
          trigger_config?: Json;
          steps?: Json;
          allow_reenrollment?: boolean;
          ai_brief?: Json | null;
          enrolled_count?: number;
          completed_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          status?: "draft" | "active" | "paused" | "archived";
          trigger_type?: string;
          trigger_config?: Json;
          steps?: Json;
          allow_reenrollment?: boolean;
          ai_brief?: Json | null;
          enrolled_count?: number;
          completed_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workflow_enrollments: {
        Row: {
          id: string;
          workflow_id: string;
          lead_id: string;
          status: "active" | "completed" | "exited" | "failed";
          current_step: number;
          next_run_at: string;
          context: Json;
          last_error: string | null;
          enrolled_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          lead_id: string;
          status?: "active" | "completed" | "exited" | "failed";
          current_step?: number;
          next_run_at?: string;
          context?: Json;
          last_error?: string | null;
          enrolled_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          workflow_id?: string;
          lead_id?: string;
          status?: "active" | "completed" | "exited" | "failed";
          current_step?: number;
          next_run_at?: string;
          context?: Json;
          last_error?: string | null;
          enrolled_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      crm_tasks: {
        Row: {
          id: string;
          lead_id: string | null;
          title: string;
          description: string | null;
          status: "open" | "done";
          due_at: string | null;
          created_by: string;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id?: string | null;
          title: string;
          description?: string | null;
          status?: "open" | "done";
          due_at?: string | null;
          created_by?: string;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string | null;
          title?: string;
          description?: string | null;
          status?: "open" | "done";
          due_at?: string | null;
          created_by?: string;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          lead_id: string | null;
          title: string;
          starts_at: string;
          ends_at: string | null;
          status: "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";
          location: string | null;
          notes: string | null;
          source: string | null;
          cal_uid: string | null;
          event_slug: string | null;
          timezone: string | null;
          meeting_url: string | null;
          reschedule_url: string | null;
          cancel_url: string | null;
          raw: Json | null;
          reminder_24h_sent_at: string | null;
          reminder_1h_sent_at: string | null;
          updated_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id?: string | null;
          title: string;
          starts_at: string;
          ends_at?: string | null;
          status?: "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";
          location?: string | null;
          notes?: string | null;
          source?: string | null;
          cal_uid?: string | null;
          event_slug?: string | null;
          timezone?: string | null;
          meeting_url?: string | null;
          reschedule_url?: string | null;
          cancel_url?: string | null;
          raw?: Json | null;
          reminder_24h_sent_at?: string | null;
          reminder_1h_sent_at?: string | null;
          updated_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string | null;
          title?: string;
          starts_at?: string;
          ends_at?: string | null;
          status?: "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";
          location?: string | null;
          notes?: string | null;
          source?: string | null;
          cal_uid?: string | null;
          event_slug?: string | null;
          timezone?: string | null;
          meeting_url?: string | null;
          reschedule_url?: string | null;
          cancel_url?: string | null;
          raw?: Json | null;
          reminder_24h_sent_at?: string | null;
          reminder_1h_sent_at?: string | null;
          updated_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      backend_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      brand_context: {
        Row: {
          key: string;
          category: string;
          content: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          category: string;
          content: string;
          updated_at?: string;
        };
        Update: {
          key?: string;
          category?: string;
          content?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      funnel_events: {
        Row: {
          id: string;
          funnel: string;
          session_id: string;
          event_type: string;
          screen_index: number | null;
          screen_id: string | null;
          event_data: Json;
          page_url: string | null;
          referrer: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          funnel?: string;
          session_id: string;
          event_type: string;
          screen_index?: number | null;
          screen_id?: string | null;
          event_data?: Json;
          page_url?: string | null;
          referrer?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          funnel?: string;
          session_id?: string;
          event_type?: string;
          screen_index?: number | null;
          screen_id?: string | null;
          event_data?: Json;
          page_url?: string | null;
          referrer?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      content_status: "draft" | "published" | "archived";
      content_type: "article" | "case_study" | "video" | "guide" | "landing_page" | "snippet";
      content_creator: "human" | "content_agent" | "seo_agent";
      offer_status: "active" | "paused" | "archived";
      lead_status: "new" | "engaged" | "qualified" | "converted" | "lost";
      entity_type: "organization" | "person" | "service" | "product" | "article" | "case_study" | "concept" | "event" | "place" | "thing";
      rule_status: "active" | "paused" | "archived";
      sequence_status: "active" | "paused" | "archived";
      send_status: "pending" | "sent" | "failed" | "bounced" | "simulated" | "suppressed";
      email_event_type: "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed";
      conversation_channel: "web_chat" | "whatsapp";
      conversation_status: "active" | "closed" | "archived";
      message_role: "user" | "assistant" | "system";
      agent_name: "content_agent" | "seo_agent" | "openclawd" | "analytics_agent" | "email_agent";
      agent_action_status: "started" | "completed" | "failed";
      calendar_status: "planned" | "approved" | "writing" | "draft" | "published" | "archived";
      calendar_priority: "high" | "medium" | "low";
      email_subscription_status: "subscribed" | "unsubscribed" | "bounced" | "complained";
      opportunity_status: "open" | "won" | "lost";
      workflow_status: "draft" | "active" | "paused" | "archived";
      enrollment_status: "active" | "completed" | "exited" | "failed";
      crm_task_status: "open" | "done";
      appointment_status: "scheduled" | "completed" | "cancelled" | "no_show";
      intent_type: "how_to" | "comparison" | "definition" | "informational" | "commercial" | "transactional" | "listicle" | "case_study" | "opinion";
    };
  };
};

// Convenience type helpers
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
