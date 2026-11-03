export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_actions: {
        Row: {
          created_at: string
          decided_at: string | null
          executed_at: string | null
          id: string
          payload: Json
          result: Json | null
          run_id: string | null
          status: string
          summary: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          executed_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          run_id?: string | null
          status?: string
          summary?: string | null
          title: string
          type: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          executed_at?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          run_id?: string | null
          status?: string
          summary?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          note: string | null
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          note?: string | null
          revoked_at?: string | null
          scopes: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          note?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: []
      }
      agent_logs: {
        Row: {
          action: string
          agent: Database["public"]["Enums"]["agent_name"]
          created_at: string | null
          description: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          input_data: Json | null
          output_data: Json | null
          status: Database["public"]["Enums"]["agent_action_status"] | null
          target_id: string | null
          target_table: string | null
          tokens_used: number | null
        }
        Insert: {
          action: string
          agent: Database["public"]["Enums"]["agent_name"]
          created_at?: string | null
          description?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_data?: Json | null
          output_data?: Json | null
          status?: Database["public"]["Enums"]["agent_action_status"] | null
          target_id?: string | null
          target_table?: string | null
          tokens_used?: number | null
        }
        Update: {
          action?: string
          agent?: Database["public"]["Enums"]["agent_name"]
          created_at?: string | null
          description?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_data?: Json | null
          output_data?: Json | null
          status?: Database["public"]["Enums"]["agent_action_status"] | null
          target_id?: string | null
          target_table?: string | null
          tokens_used?: number | null
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          report_md: string | null
          status: string
          summary: string | null
          tokens_used: number | null
          tool_calls: Json
          trigger: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          report_md?: string | null
          status?: string
          summary?: string | null
          tokens_used?: number | null
          tool_calls?: Json
          trigger?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          report_md?: string | null
          status?: string
          summary?: string | null
          tokens_used?: number | null
          tool_calls?: Json
          trigger?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          anonymous_id: string
          content_id: string | null
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          offer_id: string | null
          page_slug: string | null
          page_url: string | null
          referrer: string | null
          visitor_id: string | null
          visitor_segment: string | null
        }
        Insert: {
          anonymous_id: string
          content_id?: string | null
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          offer_id?: string | null
          page_slug?: string | null
          page_url?: string | null
          referrer?: string | null
          visitor_id?: string | null
          visitor_segment?: string | null
        }
        Update: {
          anonymous_id?: string
          content_id?: string | null
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          offer_id?: string | null
          page_slug?: string | null
          page_url?: string | null
          referrer?: string | null
          visitor_id?: string | null
          visitor_segment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          cal_uid: string | null
          cancel_url: string | null
          created_at: string | null
          ends_at: string | null
          event_slug: string | null
          id: string
          lead_id: string | null
          location: string | null
          meeting_url: string | null
          notes: string | null
          raw: Json | null
          reminder_1h_sent_at: string | null
          reminder_24h_sent_at: string | null
          reschedule_url: string | null
          source: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          timezone: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          cal_uid?: string | null
          cancel_url?: string | null
          created_at?: string | null
          ends_at?: string | null
          event_slug?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          notes?: string | null
          raw?: Json | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
          reschedule_url?: string | null
          source?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          timezone?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          cal_uid?: string | null
          cancel_url?: string | null
          created_at?: string | null
          ends_at?: string | null
          event_slug?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          notes?: string | null
          raw?: Json | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
          reschedule_url?: string | null
          source?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          timezone?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      backend_settings: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      brand_context: {
        Row: {
          category: string
          content: string
          key: string
          updated_at: string | null
        }
        Insert: {
          category: string
          content: string
          key: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          content?: string
          key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      content_calendar: {
        Row: {
          content_object_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          intent_type: Database["public"]["Enums"]["intent_type"] | null
          keyword_cluster: string | null
          notes: string | null
          pillar_topic: string | null
          priority: Database["public"]["Enums"]["calendar_priority"] | null
          run_id: string | null
          scheduled_publish_date: string | null
          search_query: string | null
          seo_meta_id: string | null
          status: Database["public"]["Enums"]["calendar_status"] | null
          target_keyword: string | null
          title: string
          topic_cluster: string | null
          updated_at: string | null
        }
        Insert: {
          content_object_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          intent_type?: Database["public"]["Enums"]["intent_type"] | null
          keyword_cluster?: string | null
          notes?: string | null
          pillar_topic?: string | null
          priority?: Database["public"]["Enums"]["calendar_priority"] | null
          run_id?: string | null
          scheduled_publish_date?: string | null
          search_query?: string | null
          seo_meta_id?: string | null
          status?: Database["public"]["Enums"]["calendar_status"] | null
          target_keyword?: string | null
          title: string
          topic_cluster?: string | null
          updated_at?: string | null
        }
        Update: {
          content_object_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          intent_type?: Database["public"]["Enums"]["intent_type"] | null
          keyword_cluster?: string | null
          notes?: string | null
          pillar_topic?: string | null
          priority?: Database["public"]["Enums"]["calendar_priority"] | null
          run_id?: string | null
          scheduled_publish_date?: string | null
          search_query?: string | null
          seo_meta_id?: string | null
          status?: Database["public"]["Enums"]["calendar_status"] | null
          target_keyword?: string | null
          title?: string
          topic_cluster?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_calendar_content_object_id_fkey"
            columns: ["content_object_id"]
            isOneToOne: false
            referencedRelation: "content_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_calendar_seo_meta_id_fkey"
            columns: ["seo_meta_id"]
            isOneToOne: false
            referencedRelation: "seo_meta"
            referencedColumns: ["id"]
          },
        ]
      }
      content_objects: {
        Row: {
          associated_offers: string[] | null
          author_name: string | null
          avg_time_on_page: number | null
          body: string | null
          content_type: Database["public"]["Enums"]["content_type"]
          conversion_count: number | null
          created_at: string | null
          created_by: Database["public"]["Enums"]["content_creator"] | null
          engagement_score: number | null
          excerpt: string | null
          featured_image_url: string | null
          featured_video_url: string | null
          id: string
          published_at: string | null
          semantic_tags: string[] | null
          seo_meta_id: string | null
          slug: string
          status: Database["public"]["Enums"]["content_status"] | null
          subtitle: string | null
          target_segments: string[] | null
          title: string
          unique_visitors: number | null
          updated_at: string | null
          view_count: number | null
        }
        Insert: {
          associated_offers?: string[] | null
          author_name?: string | null
          avg_time_on_page?: number | null
          body?: string | null
          content_type?: Database["public"]["Enums"]["content_type"]
          conversion_count?: number | null
          created_at?: string | null
          created_by?: Database["public"]["Enums"]["content_creator"] | null
          engagement_score?: number | null
          excerpt?: string | null
          featured_image_url?: string | null
          featured_video_url?: string | null
          id?: string
          published_at?: string | null
          semantic_tags?: string[] | null
          seo_meta_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["content_status"] | null
          subtitle?: string | null
          target_segments?: string[] | null
          title: string
          unique_visitors?: number | null
          updated_at?: string | null
          view_count?: number | null
        }
        Update: {
          associated_offers?: string[] | null
          author_name?: string | null
          avg_time_on_page?: number | null
          body?: string | null
          content_type?: Database["public"]["Enums"]["content_type"]
          conversion_count?: number | null
          created_at?: string | null
          created_by?: Database["public"]["Enums"]["content_creator"] | null
          engagement_score?: number | null
          excerpt?: string | null
          featured_image_url?: string | null
          featured_video_url?: string | null
          id?: string
          published_at?: string | null
          semantic_tags?: string[] | null
          seo_meta_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["content_status"] | null
          subtitle?: string | null
          target_segments?: string[] | null
          title?: string
          unique_visitors?: number | null
          updated_at?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_objects_seo_meta_id_fkey"
            columns: ["seo_meta_id"]
            isOneToOne: false
            referencedRelation: "seo_meta"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel: Database["public"]["Enums"]["conversation_channel"]
          closed_at: string | null
          context: Json | null
          created_at: string | null
          external_id: string | null
          id: string
          last_message_at: string | null
          lead_id: string | null
          message_count: number | null
          started_at: string | null
          started_on_page: string | null
          status: Database["public"]["Enums"]["conversation_status"] | null
          updated_at: string | null
          visitor_id: string | null
          visitor_segment: string | null
        }
        Insert: {
          channel?: Database["public"]["Enums"]["conversation_channel"]
          closed_at?: string | null
          context?: Json | null
          created_at?: string | null
          external_id?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          started_at?: string | null
          started_on_page?: string | null
          status?: Database["public"]["Enums"]["conversation_status"] | null
          updated_at?: string | null
          visitor_id?: string | null
          visitor_segment?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["conversation_channel"]
          closed_at?: string | null
          context?: Json | null
          created_at?: string | null
          external_id?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          message_count?: number | null
          started_at?: string | null
          started_on_page?: string | null
          status?: Database["public"]["Enums"]["conversation_status"] | null
          updated_at?: string | null
          visitor_id?: string | null
          visitor_segment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_fields: {
        Row: {
          created_at: string | null
          field_type: string
          id: string
          key: string
          label: string
          options: Json
          sort_order: number
        }
        Insert: {
          created_at?: string | null
          field_type?: string
          id?: string
          key: string
          label: string
          options?: Json
          sort_order?: number
        }
        Update: {
          created_at?: string | null
          field_type?: string
          id?: string
          key?: string
          label?: string
          options?: Json
          sort_order?: number
        }
        Relationships: []
      }
      crm_tags: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      crm_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string
          description: string | null
          due_at: string | null
          id: string
          lead_id: string | null
          status: Database["public"]["Enums"]["crm_task_status"]
          title: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          status?: Database["public"]["Enums"]["crm_task_status"]
          title: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          status?: Database["public"]["Enums"]["crm_task_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_type: Database["public"]["Enums"]["email_event_type"]
          id: string
          lead_id: string
          send_id: string
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_type: Database["public"]["Enums"]["email_event_type"]
          id?: string
          lead_id: string
          send_id: string
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: Database["public"]["Enums"]["email_event_type"]
          id?: string
          lead_id?: string
          send_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          body_html: string | null
          clicked_at: string | null
          created_at: string | null
          email_address: string
          email_template_id: string | null
          enrollment_id: string | null
          error_message: string | null
          id: string
          lead_id: string
          opened_at: string | null
          resend_id: string | null
          sent_at: string | null
          sequence_id: string | null
          status: Database["public"]["Enums"]["send_status"] | null
          step_number: number | null
          subject: string
          template_id: string | null
          variant: string | null
          workflow_id: string | null
        }
        Insert: {
          body_html?: string | null
          clicked_at?: string | null
          created_at?: string | null
          email_address: string
          email_template_id?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          id?: string
          lead_id: string
          opened_at?: string | null
          resend_id?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          status?: Database["public"]["Enums"]["send_status"] | null
          step_number?: number | null
          subject: string
          template_id?: string | null
          variant?: string | null
          workflow_id?: string | null
        }
        Update: {
          body_html?: string | null
          clicked_at?: string | null
          created_at?: string | null
          email_address?: string
          email_template_id?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string
          opened_at?: string | null
          resend_id?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          status?: Database["public"]["Enums"]["send_status"] | null
          step_number?: number | null
          subject?: string
          template_id?: string | null
          variant?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_email_template_id_fkey"
            columns: ["email_template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "workflow_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequences: {
        Row: {
          avg_click_rate: number | null
          avg_open_rate: number | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["sequence_status"] | null
          steps: Json
          target_segments: string[] | null
          total_completed: number | null
          total_enrolled: number | null
          trigger_config: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          avg_click_rate?: number | null
          avg_open_rate?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["sequence_status"] | null
          steps?: Json
          target_segments?: string[] | null
          total_completed?: number | null
          total_enrolled?: number | null
          trigger_config?: Json | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          avg_click_rate?: number | null
          avg_open_rate?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["sequence_status"] | null
          steps?: Json
          target_segments?: string[] | null
          total_completed?: number | null
          total_enrolled?: number | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          ai_generated: boolean
          body_md: string
          category: string | null
          created_at: string | null
          id: string
          name: string
          preheader: string | null
          subject: string
          subject_b: string | null
          updated_at: string | null
        }
        Insert: {
          ai_generated?: boolean
          body_md: string
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
          preheader?: string | null
          subject: string
          subject_b?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_generated?: boolean
          body_md?: string
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
          preheader?: string | null
          subject?: string
          subject_b?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      engagement_deliverables: {
        Row: {
          created_at: string
          due_at: string | null
          engagement_id: string
          id: string
          name: string
          position: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_at?: string | null
          engagement_id: string
          id?: string
          name: string
          position?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_at?: string | null
          engagement_id?: string
          id?: string
          name?: string
          position?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_deliverables_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      engagements: {
        Row: {
          created_at: string
          currency: string
          due_at: string | null
          id: string
          lead_id: string | null
          metadata: Json
          name: string
          opportunity_id: string | null
          scope: string | null
          stage: string
          started_at: string | null
          status: string
          updated_at: string
          value_minor: number
        }
        Insert: {
          created_at?: string
          currency: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          name: string
          opportunity_id?: string | null
          scope?: string | null
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          value_minor?: number
        }
        Update: {
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          name?: string
          opportunity_id?: string | null
          scope?: string | null
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          value_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "engagements_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          appears_on_pages: string[] | null
          created_at: string | null
          description: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          image_height: number | null
          image_url: string | null
          image_width: number | null
          knows_about: Json | null
          last_audited_at: string | null
          managed_by: string | null
          name: string
          properties: Json | null
          same_as: string[] | null
          schema_id: string | null
          schema_type: string
          slug: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          appears_on_pages?: string[] | null
          created_at?: string | null
          description?: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          knows_about?: Json | null
          last_audited_at?: string | null
          managed_by?: string | null
          name: string
          properties?: Json | null
          same_as?: string[] | null
          schema_id?: string | null
          schema_type: string
          slug: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          appears_on_pages?: string[] | null
          created_at?: string | null
          description?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          knows_about?: Json | null
          last_audited_at?: string | null
          managed_by?: string | null
          name?: string
          properties?: Json | null
          same_as?: string[] | null
          schema_id?: string | null
          schema_type?: string
          slug?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      entity_relationships: {
        Row: {
          created_at: string | null
          id: string
          object_id: string
          predicate: string
          properties: Json | null
          subject_id: string
          weight: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          object_id: string
          predicate: string
          properties?: Json | null
          subject_id: string
          weight?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          object_id?: string
          predicate?: string
          properties?: Json | null
          subject_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_events: {
        Row: {
          created_at: string
          event_data: Json
          event_type: string
          funnel: string
          id: string
          page_url: string | null
          referrer: string | null
          screen_id: string | null
          screen_index: number | null
          session_id: string
        }
        Insert: {
          created_at?: string
          event_data?: Json
          event_type: string
          funnel?: string
          id?: string
          page_url?: string | null
          referrer?: string | null
          screen_id?: string | null
          screen_index?: number | null
          session_id: string
        }
        Update: {
          created_at?: string
          event_data?: Json
          event_type?: string
          funnel?: string
          id?: string
          page_url?: string | null
          referrer?: string | null
          screen_id?: string | null
          screen_index?: number | null
          session_id?: string
        }
        Relationships: []
      }
      home_events: {
        Row: {
          action: string
          actor: string
          actor_type: string
          evidence: Json
          id: string
          lead_id: string | null
          occurred_at: string
          payload: Json
          seq: number
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          action: string
          actor: string
          actor_type: string
          evidence?: Json
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          seq?: never
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          action?: string
          actor?: string
          actor_type?: string
          evidence?: Json
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          seq?: never
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          amount_minor: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          product_id: string | null
          quantity: number
        }
        Insert: {
          amount_minor: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          product_id?: string | null
          quantity?: number
        }
        Update: {
          amount_minor?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          product_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          currency: string
          due_at: string | null
          engagement_id: string | null
          hosted_url: string | null
          id: string
          lead_id: string | null
          metadata: Json
          number: string
          paid_at: string | null
          pdf_url: string | null
          status: string
          stripe_invoice_id: string | null
          total_minor: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency: string
          due_at?: string | null
          engagement_id?: string | null
          hosted_url?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          number: string
          paid_at?: string | null
          pdf_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          total_minor?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          due_at?: string | null
          engagement_id?: string | null
          hosted_url?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json
          number?: string
          paid_at?: string | null
          pdf_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          total_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          activity_type: string
          actor: string
          body: string | null
          created_at: string | null
          data: Json
          id: string
          lead_id: string
          title: string
        }
        Insert: {
          activity_type: string
          actor?: string
          body?: string | null
          created_at?: string | null
          data?: Json
          id?: string
          lead_id: string
          title: string
        }
        Update: {
          activity_type?: string
          actor?: string
          body?: string | null
          created_at?: string | null
          data?: Json
          id?: string
          lead_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          capture_page: string | null
          company: string | null
          created_at: string | null
          custom: Json
          email: string
          email_status: Database["public"]["Enums"]["email_subscription_status"]
          first_name: string | null
          id: string
          interested_offers: string[] | null
          last_activity_at: string
          last_name: string | null
          phone: string | null
          score: number | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tags: string[] | null
          timezone: string | null
          unsubscribe_token: string
          updated_at: string | null
          visitor_id: string | null
        }
        Insert: {
          capture_page?: string | null
          company?: string | null
          created_at?: string | null
          custom?: Json
          email: string
          email_status?: Database["public"]["Enums"]["email_subscription_status"]
          first_name?: string | null
          id?: string
          interested_offers?: string[] | null
          last_activity_at?: string
          last_name?: string | null
          phone?: string | null
          score?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tags?: string[] | null
          timezone?: string | null
          unsubscribe_token?: string
          updated_at?: string | null
          visitor_id?: string | null
        }
        Update: {
          capture_page?: string | null
          company?: string | null
          created_at?: string | null
          custom?: Json
          email?: string
          email_status?: Database["public"]["Enums"]["email_subscription_status"]
          first_name?: string | null
          id?: string
          interested_offers?: string[] | null
          last_activity_at?: string
          last_name?: string | null
          phone?: string | null
          score?: number | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tags?: string[] | null
          timezone?: string | null
          unsubscribe_token?: string
          updated_at?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          alt_text: string | null
          caption: string | null
          created_at: string | null
          duration: number | null
          file_size: number | null
          filename: string
          height: number | null
          id: string
          mime_type: string
          r2_key: string
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string | null
          url: string
          used_in_content: string[] | null
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          duration?: number | null
          file_size?: number | null
          filename: string
          height?: number | null
          id?: string
          mime_type: string
          r2_key: string
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by?: string | null
          url: string
          used_in_content?: string[] | null
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          duration?: number | null
          file_size?: number | null
          filename?: string
          height?: number | null
          id?: string
          mime_type?: string
          r2_key?: string
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by?: string | null
          url?: string
          used_in_content?: string[] | null
          width?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          metadata: Json | null
          model: string | null
          role: Database["public"]["Enums"]["message_role"]
          token_count: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          model?: string | null
          role: Database["public"]["Enums"]["message_role"]
          token_count?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          model?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          benefits: string[] | null
          billing_cycle: string | null
          click_count: number | null
          conversion_count: number | null
          conversion_rate: number | null
          created_at: string | null
          cta_text: string | null
          cta_url: string | null
          currency: string | null
          description: string | null
          featured_image_url: string | null
          id: string
          name: string
          position_in_ladder: number | null
          price_cents: number | null
          price_display: string | null
          slug: string
          status: Database["public"]["Enums"]["offer_status"] | null
          tagline: string | null
          target_segments: string[] | null
          updated_at: string | null
          view_count: number | null
          who_its_for: string | null
        }
        Insert: {
          benefits?: string[] | null
          billing_cycle?: string | null
          click_count?: number | null
          conversion_count?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          cta_text?: string | null
          cta_url?: string | null
          currency?: string | null
          description?: string | null
          featured_image_url?: string | null
          id?: string
          name: string
          position_in_ladder?: number | null
          price_cents?: number | null
          price_display?: string | null
          slug: string
          status?: Database["public"]["Enums"]["offer_status"] | null
          tagline?: string | null
          target_segments?: string[] | null
          updated_at?: string | null
          view_count?: number | null
          who_its_for?: string | null
        }
        Update: {
          benefits?: string[] | null
          billing_cycle?: string | null
          click_count?: number | null
          conversion_count?: number | null
          conversion_rate?: number | null
          created_at?: string | null
          cta_text?: string | null
          cta_url?: string | null
          currency?: string | null
          description?: string | null
          featured_image_url?: string | null
          id?: string
          name?: string
          position_in_ladder?: number | null
          price_cents?: number | null
          price_display?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["offer_status"] | null
          tagline?: string | null
          target_segments?: string[] | null
          updated_at?: string | null
          view_count?: number | null
          who_its_for?: string | null
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          created_at: string | null
          currency: string
          id: string
          lead_id: string
          lost_at: string | null
          lost_reason: string | null
          name: string
          pipeline_id: string
          position: number
          stage_id: string
          status: Database["public"]["Enums"]["opportunity_status"]
          updated_at: string | null
          value_cents: number
          won_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string
          id?: string
          lead_id: string
          lost_at?: string | null
          lost_reason?: string | null
          name: string
          pipeline_id: string
          position?: number
          stage_id: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          updated_at?: string | null
          value_cents?: number
          won_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string
          id?: string
          lead_id?: string
          lost_at?: string | null
          lost_reason?: string | null
          name?: string
          pipeline_id?: string
          position?: number
          stage_id?: string
          status?: Database["public"]["Enums"]["opportunity_status"]
          updated_at?: string | null
          value_cents?: number
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          amount_minor: number
          created_at: string
          id: string
          order_id: string
          product_id: string | null
          quantity: number
        }
        Insert: {
          amount_minor: number
          created_at?: string
          id?: string
          order_id: string
          product_id?: string | null
          quantity?: number
        }
        Update: {
          amount_minor?: number
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          email: string | null
          id: string
          lead_id: string | null
          livemode: boolean | null
          metadata: Json
          paid_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          total_minor: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency: string
          email?: string | null
          id?: string
          lead_id?: string | null
          livemode?: boolean | null
          metadata?: Json
          paid_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          total_minor?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          lead_id?: string | null
          livemode?: boolean | null
          metadata?: Json
          paid_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          total_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          claimed_at: string | null
          error: string | null
          id: string
          livemode: boolean | null
          payload: Json
          processed_at: string | null
          provider: string
          provider_event_id: string
          received_at: string
          result: Json | null
          type: string
        }
        Insert: {
          claimed_at?: string | null
          error?: string | null
          id?: string
          livemode?: boolean | null
          payload: Json
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          received_at?: string
          result?: Json | null
          type: string
        }
        Update: {
          claimed_at?: string | null
          error?: string | null
          id?: string
          livemode?: boolean | null
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          result?: Json | null
          type?: string
        }
        Relationships: []
      }
      payouts: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          id: string
          lead_id: string | null
          reason: string | null
          status: string
          stripe_transfer_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          id?: string
          lead_id?: string | null
          reason?: string | null
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          lead_id?: string | null
          reason?: string | null
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      personalization_rules: {
        Row: {
          action: Json
          condition: Json
          conversion_rate: number | null
          conversions: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          impressions: number | null
          last_evaluated_at: string | null
          name: string
          page_patterns: string[] | null
          priority: number | null
          status: Database["public"]["Enums"]["rule_status"] | null
          updated_at: string | null
        }
        Insert: {
          action: Json
          condition: Json
          conversion_rate?: number | null
          conversions?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          impressions?: number | null
          last_evaluated_at?: string | null
          name: string
          page_patterns?: string[] | null
          priority?: number | null
          status?: Database["public"]["Enums"]["rule_status"] | null
          updated_at?: string | null
        }
        Update: {
          action?: Json
          condition?: Json
          conversion_rate?: number | null
          conversions?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          impressions?: number | null
          last_evaluated_at?: string | null
          name?: string
          page_patterns?: string[] | null
          priority?: number | null
          status?: Database["public"]["Enums"]["rule_status"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          created_at: string | null
          id: string
          name: string
          pipeline_id: string
          position: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          pipeline_id: string
          position?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          pipeline_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean
          name: string
          position: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean
          name: string
          position?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean
          name?: string
          position?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          amount_minor: number
          created_at: string
          currency: string
          description: string | null
          id: string
          interval: string | null
          kind: string
          metadata: Json
          name: string
          slug: string
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_minor: number
          created_at?: string
          currency: string
          description?: string | null
          id?: string
          interval?: string | null
          kind: string
          metadata?: Json
          name: string
          slug: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_minor?: number
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          interval?: string | null
          kind?: string
          metadata?: Json
          name?: string
          slug?: string
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      schema_migrations: {
        Row: {
          applied_at: string
          applied_by: string | null
          checksum: string | null
          name: string
          repo: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          checksum?: string | null
          name: string
          repo: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          checksum?: string | null
          name?: string
          repo?: string
        }
        Relationships: []
      }
      seo_meta: {
        Row: {
          breadcrumb_path: Json | null
          canonical_url: string | null
          clicks_30d: number | null
          created_at: string | null
          ctr_30d: number | null
          current_rank: number | null
          description: string | null
          id: string
          impressions_30d: number | null
          keyword_cluster: string | null
          og_image_url: string | null
          schema_type: string | null
          secondary_keywords: string[] | null
          target_keyword: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          breadcrumb_path?: Json | null
          canonical_url?: string | null
          clicks_30d?: number | null
          created_at?: string | null
          ctr_30d?: number | null
          current_rank?: number | null
          description?: string | null
          id?: string
          impressions_30d?: number | null
          keyword_cluster?: string | null
          og_image_url?: string | null
          schema_type?: string | null
          secondary_keywords?: string[] | null
          target_keyword?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          breadcrumb_path?: Json | null
          canonical_url?: string | null
          clicks_30d?: number | null
          created_at?: string | null
          ctr_30d?: number | null
          current_rank?: number | null
          description?: string | null
          id?: string
          impressions_30d?: number | null
          keyword_cluster?: string | null
          og_image_url?: string | null
          schema_type?: string | null
          secondary_keywords?: string[] | null
          target_keyword?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          access_token: string | null
          connected_at: string
          created_at: string
          external_id: string
          id: string
          metadata: Json
          name: string
          platform: string
          refresh_token: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          external_id: string
          id?: string
          metadata?: Json
          name: string
          platform: string
          refresh_token?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          access_token?: string | null
          connected_at?: string
          created_at?: string
          external_id?: string
          id?: string
          metadata?: Json
          name?: string
          platform?: string
          refresh_token?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      social_metrics: {
        Row: {
          captured_at: string
          comments: number
          id: string
          likes: number
          raw: Json
          reach: number
          saves: number
          shares: number
          target_id: string
          views: number
        }
        Insert: {
          captured_at?: string
          comments?: number
          id?: string
          likes?: number
          raw?: Json
          reach?: number
          saves?: number
          shares?: number
          target_id: string
          views?: number
        }
        Update: {
          captured_at?: string
          comments?: number
          id?: string
          likes?: number
          raw?: Json
          reach?: number
          saves?: number
          shares?: number
          target_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_metrics_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "social_post_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_media: {
        Row: {
          created_at: string
          id: string
          kind: string
          path: string | null
          position: number
          post_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          path?: string | null
          position?: number
          post_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          path?: string | null
          position?: number
          post_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_targets: {
        Row: {
          account_id: string
          attempts: number
          caption_override: string | null
          created_at: string
          error: string | null
          external_id: string | null
          external_url: string | null
          id: string
          platform: string
          platform_ref: Json
          post_id: string
          published_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          attempts?: number
          caption_override?: string | null
          created_at?: string
          error?: string | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          platform: string
          platform_ref?: Json
          post_id: string
          published_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          caption_override?: string | null
          created_at?: string
          error?: string | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          platform?: string
          platform_ref?: Json
          post_id?: string
          published_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_targets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_targets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          caption: string
          created_at: string
          created_by: string
          error: string | null
          id: string
          post_type: string
          published_at: string | null
          scheduled_at: string | null
          status: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          video_path: string | null
          video_url: string | null
        }
        Insert: {
          caption?: string
          created_at?: string
          created_by?: string
          error?: string | null
          id?: string
          post_type?: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          video_path?: string | null
          video_url?: string | null
        }
        Update: {
          caption?: string
          created_at?: string
          created_by?: string
          error?: string | null
          id?: string
          post_type?: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          video_path?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      visitors: {
        Row: {
          ai_referrer_source: string | null
          anonymous_id: string
          browser: string | null
          city: string | null
          content_affinities: string[] | null
          country: string | null
          created_at: string | null
          device_type: string | null
          first_campaign: string | null
          first_medium: string | null
          first_referrer: string | null
          first_referrer_domain: string | null
          first_seen_at: string | null
          first_source: string | null
          id: string
          is_ai_traffic: boolean | null
          last_seen_at: string | null
          latest_campaign: string | null
          latest_medium: string | null
          latest_referrer: string | null
          latest_source: string | null
          lead_id: string | null
          os: string | null
          pages_viewed: string[] | null
          segment: string | null
          updated_at: string | null
          visit_count: number | null
        }
        Insert: {
          ai_referrer_source?: string | null
          anonymous_id: string
          browser?: string | null
          city?: string | null
          content_affinities?: string[] | null
          country?: string | null
          created_at?: string | null
          device_type?: string | null
          first_campaign?: string | null
          first_medium?: string | null
          first_referrer?: string | null
          first_referrer_domain?: string | null
          first_seen_at?: string | null
          first_source?: string | null
          id?: string
          is_ai_traffic?: boolean | null
          last_seen_at?: string | null
          latest_campaign?: string | null
          latest_medium?: string | null
          latest_referrer?: string | null
          latest_source?: string | null
          lead_id?: string | null
          os?: string | null
          pages_viewed?: string[] | null
          segment?: string | null
          updated_at?: string | null
          visit_count?: number | null
        }
        Update: {
          ai_referrer_source?: string | null
          anonymous_id?: string
          browser?: string | null
          city?: string | null
          content_affinities?: string[] | null
          country?: string | null
          created_at?: string | null
          device_type?: string | null
          first_campaign?: string | null
          first_medium?: string | null
          first_referrer?: string | null
          first_referrer_domain?: string | null
          first_seen_at?: string | null
          first_source?: string | null
          id?: string
          is_ai_traffic?: boolean | null
          last_seen_at?: string | null
          latest_campaign?: string | null
          latest_medium?: string | null
          latest_referrer?: string | null
          latest_source?: string | null
          lead_id?: string | null
          os?: string | null
          pages_viewed?: string[] | null
          segment?: string | null
          updated_at?: string | null
          visit_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_visitors_lead"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_enrollments: {
        Row: {
          completed_at: string | null
          context: Json
          current_step: number
          enrolled_at: string | null
          id: string
          last_error: string | null
          lead_id: string
          next_run_at: string
          status: Database["public"]["Enums"]["enrollment_status"]
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          context?: Json
          current_step?: number
          enrolled_at?: string | null
          id?: string
          last_error?: string | null
          lead_id: string
          next_run_at?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          context?: Json
          current_step?: number
          enrolled_at?: string | null
          id?: string
          last_error?: string | null
          lead_id?: string
          next_run_at?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_enrollments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_enrollments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          ai_brief: Json | null
          allow_reenrollment: boolean
          completed_count: number
          created_at: string | null
          description: string | null
          enrolled_count: number
          id: string
          name: string
          status: Database["public"]["Enums"]["workflow_status"]
          steps: Json
          trigger_config: Json
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          ai_brief?: Json | null
          allow_reenrollment?: boolean
          completed_count?: number
          created_at?: string | null
          description?: string | null
          enrolled_count?: number
          id?: string
          name: string
          status?: Database["public"]["Enums"]["workflow_status"]
          steps?: Json
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string | null
        }
        Update: {
          ai_brief?: Json | null
          allow_reenrollment?: boolean
          completed_count?: number
          created_at?: string | null
          description?: string | null
          enrolled_count?: number
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["workflow_status"]
          steps?: Json
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      home_event_counts: {
        Args: { since: string }
        Returns: {
          action: string
          count: number
        }[]
      }
      home_event_id_or_null: { Args: { value: string }; Returns: string }
      scrub_home_events_for_lead: {
        Args: { p_lead_id: string }
        Returns: number
      }
    }
    Enums: {
      agent_action_status: "started" | "completed" | "failed"
      agent_name:
        | "content_agent"
        | "seo_agent"
        | "openclawd"
        | "analytics_agent"
        | "email_agent"
      appointment_status:
        | "scheduled"
        | "completed"
        | "cancelled"
        | "no_show"
        | "rescheduled"
      calendar_priority: "high" | "medium" | "low"
      calendar_status:
        | "planned"
        | "approved"
        | "writing"
        | "draft"
        | "published"
        | "archived"
      content_creator: "human" | "content_agent" | "seo_agent"
      content_status: "draft" | "published" | "archived"
      content_type:
        | "article"
        | "case_study"
        | "video"
        | "guide"
        | "landing_page"
        | "snippet"
      conversation_channel: "web_chat" | "whatsapp"
      conversation_status: "active" | "closed" | "archived"
      crm_task_status: "open" | "done"
      email_event_type:
        | "delivered"
        | "opened"
        | "clicked"
        | "bounced"
        | "complained"
        | "unsubscribed"
      email_subscription_status:
        | "subscribed"
        | "unsubscribed"
        | "bounced"
        | "complained"
      enrollment_status: "active" | "completed" | "exited" | "failed"
      entity_type:
        | "organization"
        | "person"
        | "service"
        | "product"
        | "article"
        | "case_study"
        | "concept"
        | "event"
        | "place"
        | "thing"
      intent_type:
        | "how_to"
        | "comparison"
        | "definition"
        | "informational"
        | "commercial"
        | "transactional"
        | "listicle"
        | "case_study"
        | "opinion"
      lead_status: "new" | "engaged" | "qualified" | "converted" | "lost"
      message_role: "user" | "assistant" | "system"
      offer_status: "active" | "paused" | "archived"
      opportunity_status: "open" | "won" | "lost"
      rule_status: "active" | "paused" | "archived"
      send_status:
        | "pending"
        | "sent"
        | "failed"
        | "bounced"
        | "simulated"
        | "suppressed"
      sequence_status: "active" | "paused" | "archived"
      workflow_status: "draft" | "active" | "paused" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type helpers
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

// Domain aliases for the shared schema.
export type ProductKind = "one_time" | "subscription" | "deposit" | "invoice_item";
export type OrderStatus = "pending" | "trial" | "paid" | "refunded" | "void";
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type EngagementStage =
  | "brief" | "research" | "copy" | "design" | "review" | "build" | "launch" | "care" | "closed";
export type EngagementStatus = "active" | "paused" | "won" | "lost";
export type DeliverableStatus = "todo" | "in_progress" | "review" | "done";
export type PayoutStatus = "pending" | "paid" | "failed" | "void";

export type HomeEventActorType = "human" | "agent" | "system" | "webhook";

export type HomeEventRow = Tables<"home_events">;
export type HomeEventInsert = InsertTables<"home_events">;

export type MoneyTables = Pick<Database["public"]["Tables"],
  | "products" | "orders" | "order_items" | "engagements" | "engagement_deliverables"
  | "invoices" | "invoice_items" | "payment_events" | "payouts"
>;
export type MoneyRow<T extends keyof MoneyTables> = Tables<T>;
