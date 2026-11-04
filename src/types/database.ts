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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          attempt_id: string | null
          attempt_number: number | null
          change_id: string | null
          from_status: Database["public"]["Enums"]["lead_status"] | null
          id: string
          kind: string
          lead_id: string | null
          occurred_at: string
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          owner_id: string
          page_id: string | null
          source_id: string
          subject_id: string
          to_status: Database["public"]["Enums"]["lead_status"] | null
          voided_at: string | null
        }
        Insert: {
          attempt_id?: string | null
          attempt_number?: number | null
          change_id?: string | null
          from_status?: Database["public"]["Enums"]["lead_status"] | null
          id?: string
          kind: string
          lead_id?: string | null
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          owner_id: string
          page_id?: string | null
          source_id: string
          subject_id: string
          to_status?: Database["public"]["Enums"]["lead_status"] | null
          voided_at?: string | null
        }
        Update: {
          attempt_id?: string | null
          attempt_number?: number | null
          change_id?: string | null
          from_status?: Database["public"]["Enums"]["lead_status"] | null
          id?: string
          kind?: string
          lead_id?: string | null
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          owner_id?: string
          page_id?: string | null
          source_id?: string
          subject_id?: string
          to_status?: Database["public"]["Enums"]["lead_status"] | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_attempt_id_owner_id_fkey"
            columns: ["attempt_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "activity_events_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "activity_events_page_id_owner_id_fkey"
            columns: ["page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "lead_pages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          attempt_id: string | null
          content: string
          conversation_id: string
          created_at: string
          error: string | null
          event_key: string | null
          id: string
          lease_until: string | null
          operation_id: string | null
          owner_id: string
          redacted_at: string | null
          reply_to: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_id?: string | null
          content?: string
          conversation_id: string
          created_at?: string
          error?: string | null
          event_key?: string | null
          id: string
          lease_until?: string | null
          operation_id?: string | null
          owner_id?: string
          redacted_at?: string | null
          reply_to?: string | null
          role: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          error?: string | null
          event_key?: string | null
          id?: string
          lease_until?: string | null
          operation_id?: string | null
          owner_id?: string
          redacted_at?: string | null
          reply_to?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_conversation_id_owner_id_fkey"
            columns: ["conversation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "ai_chat_messages_operation_id_owner_id_fkey"
            columns: ["operation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "ai_chat_messages_reply_to_owner_id_fkey"
            columns: ["reply_to", "owner_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_messages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          last_operation_id: string | null
          last_result_id: string | null
          owner_id: string
          scope_page_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          last_operation_id?: string | null
          last_result_id?: string | null
          owner_id?: string
          scope_page_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_operation_id?: string | null
          last_result_id?: string | null
          owner_id?: string
          scope_page_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_last_operation_id_owner_id_fkey"
            columns: ["last_operation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "ai_conversations_last_result_id_owner_id_fkey"
            columns: ["last_result_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "ai_conversations_scope_page_id_owner_id_fkey"
            columns: ["scope_page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "lead_pages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      call_attempts: {
        Row: {
          attempt_number: number
          id: string
          lead_id: string
          notes: string
          occurred_at: string
          outcome: Database["public"]["Enums"]["call_outcome"]
          owner_id: string
          request_id: string
          voided_at: string | null
        }
        Insert: {
          attempt_number: number
          id?: string
          lead_id: string
          notes?: string
          occurred_at?: string
          outcome: Database["public"]["Enums"]["call_outcome"]
          owner_id?: string
          request_id?: string
          voided_at?: string | null
        }
        Update: {
          attempt_number?: number
          id?: string
          lead_id?: string
          notes?: string
          occurred_at?: string
          outcome?: Database["public"]["Enums"]["call_outcome"]
          owner_id?: string
          request_id?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      followups: {
        Row: {
          auto_from_import: string | null
          cancelled_at: string | null
          completed_at: string | null
          completion_outcome: Database["public"]["Enums"]["call_outcome"] | null
          created_at: string
          created_by_change: string | null
          id: string
          kind: string
          lead_id: string
          notes: string
          owner_id: string
          scheduled_date: string
          scheduled_time: string | null
          updated_at: string
        }
        Insert: {
          auto_from_import?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          completion_outcome?:
            | Database["public"]["Enums"]["call_outcome"]
            | null
          created_at?: string
          created_by_change?: string | null
          id?: string
          kind?: string
          lead_id: string
          notes?: string
          owner_id?: string
          scheduled_date: string
          scheduled_time?: string | null
          updated_at?: string
        }
        Update: {
          auto_from_import?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          completion_outcome?:
            | Database["public"]["Enums"]["call_outcome"]
            | null
          created_at?: string
          created_by_change?: string | null
          id?: string
          kind?: string
          lead_id?: string
          notes?: string
          owner_id?: string
          scheduled_date?: string
          scheduled_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      import_members: {
        Row: {
          expected_deleted_at: string | null
          expected_updated_at: string
          import_id: string
          lead_id: string
          owner_id: string
          page_id: string
          role: string
        }
        Insert: {
          expected_deleted_at?: string | null
          expected_updated_at: string
          import_id: string
          lead_id: string
          owner_id: string
          page_id: string
          role: string
        }
        Update: {
          expected_deleted_at?: string | null
          expected_updated_at?: string
          import_id?: string
          lead_id?: string
          owner_id?: string
          page_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_members_import_id_page_id_owner_id_fkey"
            columns: ["import_id", "page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "page_id", "owner_id"]
          },
          {
            foreignKeyName: "import_members_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      imports: {
        Row: {
          batch_sequence: number
          completed_at: string | null
          created_at: string
          file_name: string
          id: string
          invalid_rows: number
          mode: string
          owner_id: string
          page_id: string
          replaced_count: number
          request_id: string
          skipped_duplicates: number
          status: Database["public"]["Enums"]["import_status"]
          successful_rows: number
          total_rows: number
        }
        Insert: {
          batch_sequence?: never
          completed_at?: string | null
          created_at?: string
          file_name: string
          id?: string
          invalid_rows?: number
          mode?: string
          owner_id?: string
          page_id: string
          replaced_count?: number
          request_id?: string
          skipped_duplicates?: number
          status?: Database["public"]["Enums"]["import_status"]
          successful_rows?: number
          total_rows?: number
        }
        Update: {
          batch_sequence?: never
          completed_at?: string | null
          created_at?: string
          file_name?: string
          id?: string
          invalid_rows?: number
          mode?: string
          owner_id?: string
          page_id?: string
          replaced_count?: number
          request_id?: string
          skipped_duplicates?: number
          status?: Database["public"]["Enums"]["import_status"]
          successful_rows?: number
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "imports_page_id_owner_id_fkey"
            columns: ["page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "lead_pages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      lead_pages: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          archive_reason: Database["public"]["Enums"]["archive_reason"] | null
          archived_at: string | null
          business_name: string
          country: string | null
          created_at: string
          deleted_at: string | null
          extra_fields: Json
          google_maps_url: string | null
          id: string
          import_id: string | null
          last_contacted_at: string | null
          location: string | null
          notes: string
          owner_id: string
          page_id: string
          phone: string | null
          purge_after: string | null
          rejected_at: string | null
          rejection_source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          subject_id: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          archive_reason?: Database["public"]["Enums"]["archive_reason"] | null
          archived_at?: string | null
          business_name: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          extra_fields?: Json
          google_maps_url?: string | null
          id?: string
          import_id?: string | null
          last_contacted_at?: string | null
          location?: string | null
          notes?: string
          owner_id?: string
          page_id: string
          phone?: string | null
          purge_after?: string | null
          rejected_at?: string | null
          rejection_source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          subject_id?: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          archive_reason?: Database["public"]["Enums"]["archive_reason"] | null
          archived_at?: string | null
          business_name?: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          extra_fields?: Json
          google_maps_url?: string | null
          id?: string
          import_id?: string | null
          last_contacted_at?: string | null
          location?: string | null
          notes?: string
          owner_id?: string
          page_id?: string
          phone?: string | null
          purge_after?: string | null
          rejected_at?: string | null
          rejection_source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          subject_id?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_import_id_owner_id_fkey"
            columns: ["import_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "leads_page_id_owner_id_fkey"
            columns: ["page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "lead_pages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      operation_items: {
        Row: {
          after_data: Json
          before_data: Json
          created_at: string
          id: string
          lead_id: string
          operation_id: string
          owner_id: string
        }
        Insert: {
          after_data: Json
          before_data: Json
          created_at?: string
          id?: string
          lead_id: string
          operation_id: string
          owner_id?: string
        }
        Update: {
          after_data?: Json
          before_data?: Json
          created_at?: string
          id?: string
          lead_id?: string
          operation_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_items_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "operation_items_operation_id_owner_id_fkey"
            columns: ["operation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      operations: {
        Row: {
          affected_count: number
          ai_action: string | null
          created_at: string
          finished_at: string | null
          id: string
          kind: Database["public"]["Enums"]["operation_kind"]
          owner_id: string
          permission_mode: Database["public"]["Enums"]["permission_mode"]
          request_id: string
          reverses_operation_id: string | null
          source: string
          status: Database["public"]["Enums"]["operation_status"]
          target_import_id: string | null
          target_page_id: string | null
          undo_expires_at: string
        }
        Insert: {
          affected_count?: number
          ai_action?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["operation_kind"]
          owner_id?: string
          permission_mode?: Database["public"]["Enums"]["permission_mode"]
          request_id?: string
          reverses_operation_id?: string | null
          source: string
          status?: Database["public"]["Enums"]["operation_status"]
          target_import_id?: string | null
          target_page_id?: string | null
          undo_expires_at?: string
        }
        Update: {
          affected_count?: number
          ai_action?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["operation_kind"]
          owner_id?: string
          permission_mode?: Database["public"]["Enums"]["permission_mode"]
          request_id?: string
          reverses_operation_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["operation_status"]
          target_import_id?: string | null
          target_page_id?: string | null
          undo_expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_reverses_operation_id_owner_id_fkey"
            columns: ["reverses_operation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "operations_target_import_id_target_page_id_owner_id_fkey"
            columns: ["target_import_id", "target_page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "page_id", "owner_id"]
          },
          {
            foreignKeyName: "operations_target_page_id_owner_id_fkey"
            columns: ["target_page_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "lead_pages"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      outreach_suppressions: {
        Row: {
          created_at: string
          fingerprint: string
          identifier_kind: string
          owner_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          fingerprint: string
          identifier_kind: string
          owner_id: string
          reason?: string
        }
        Update: {
          created_at?: string
          fingerprint?: string
          identifier_kind?: string
          owner_id?: string
          reason?: string
        }
        Relationships: []
      }
      workflow_changes: {
        Row: {
          after_followups: Json
          after_updated_at: string | null
          ai_operation_id: string | null
          attempt_id: string | null
          before_data: Json
          before_followups: Json
          created_at: string
          id: string
          kind: string
          lead_id: string
          owner_id: string
          request_id: string
          sequence: number
          undone_at: string | null
        }
        Insert: {
          after_followups?: Json
          after_updated_at?: string | null
          ai_operation_id?: string | null
          attempt_id?: string | null
          before_data: Json
          before_followups?: Json
          created_at?: string
          id?: string
          kind: string
          lead_id: string
          owner_id: string
          request_id: string
          sequence?: never
          undone_at?: string | null
        }
        Update: {
          after_followups?: Json
          after_updated_at?: string | null
          ai_operation_id?: string | null
          attempt_id?: string | null
          before_data?: Json
          before_followups?: Json
          created_at?: string
          id?: string
          kind?: string
          lead_id?: string
          owner_id?: string
          request_id?: string
          sequence?: never
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_changes_ai_operation_id_fkey"
            columns: ["ai_operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_changes_attempt_id_owner_id_fkey"
            columns: ["attempt_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "workflow_changes_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      workspace_preferences: {
        Row: {
          ai_permission_mode: Database["public"]["Enums"]["permission_mode"]
          owner_id: string
          updated_at: string
        }
        Insert: {
          ai_permission_mode?: Database["public"]["Enums"]["permission_mode"]
          owner_id?: string
          updated_at?: string
        }
        Update: {
          ai_permission_mode?: Database["public"]["Enums"]["permission_mode"]
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_sync: {
        Row: {
          last_transaction: number
          owner_id: string
          privacy_revision: number
          privacy_transaction: number
          revision: number
          updated_at: string
        }
        Insert: {
          last_transaction: number
          owner_id: string
          privacy_revision?: number
          privacy_transaction?: number
          revision?: number
          updated_at?: string
        }
        Update: {
          last_transaction?: number
          owner_id?: string
          privacy_revision?: number
          privacy_transaction?: number
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      lead_attempt_summary: {
        Row: {
          consecutive_failed_attempts: number | null
          failed_attempts: number | null
          last_attempt_at: string | null
          latest_outcome: Database["public"]["Enums"]["call_outcome"] | null
          lead_id: string | null
          owner_id: string | null
          total_attempts: number | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_lead_id_owner_id_fkey"
            columns: ["lead_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
    }
    Functions: {
      activity_range: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_page?: string
          p_timezone?: string
          p_to: string
        }
        Returns: Json
      }
      ai_assistant_state: { Args: never; Returns: Json }
      ai_cancel: { Args: { p_id: string }; Returns: undefined }
      ai_chat_claim: {
        Args: {
          p_assistant: string
          p_content: string
          p_conversation: string
          p_scope?: string
          p_user: string
        }
        Returns: Json
      }
      ai_chat_context: {
        Args: { p_before: string; p_conversation: string }
        Returns: Json
      }
      ai_chat_event: {
        Args: {
          p_content: string
          p_conversation: string
          p_operation: string
          p_token: string
        }
        Returns: undefined
      }
      ai_chat_finish: {
        Args: {
          p_attempt: string
          p_content: string
          p_error: string
          p_id: string
          p_operation: string
          p_status: string
          p_token: string
        }
        Returns: boolean
      }
      ai_context: {
        Args: { p_page?: string; p_recent?: string; p_selected?: string[] }
        Returns: Json
      }
      ai_csv_reserve: {
        Args: {
          p_input_bound: number
          p_request: string
          p_server_token: string
        }
        Returns: Json
      }
      ai_csv_settle: {
        Args: {
          p_input: number
          p_output: number
          p_request: string
          p_server_token: string
        }
        Returns: undefined
      }
      ai_csv_status: { Args: never; Returns: Json }
      ai_execute: {
        Args: { p_approved: boolean; p_id: string; p_token: string }
        Returns: Json
      }
      ai_plan_result: {
        Args: { p_id: string; p_offset?: number }
        Returns: Json
      }
      ai_set_mode: {
        Args: { p_mode: Database["public"]["Enums"]["permission_mode"] }
        Returns: undefined
      }
      ai_stage: {
        Args: { p_command: Json; p_request: string; p_token: string }
        Returns: Json
      }
      analytics_report: {
        Args: {
          p_from: string
          p_page?: string
          p_timezone?: string
          p_to: string
        }
        Returns: Json
      }
      calling_history_range: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_page?: string
          p_timezone?: string
          p_to: string
        }
        Returns: Json
      }
      commit_import: {
        Args: {
          p_file: string
          p_invalid: number
          p_mode: string
          p_new_name: string
          p_page: string
          p_request: string
          p_rows: Json
          p_total: number
        }
        Returns: Json
      }
      daily_activity: {
        Args: { p_day: string }
        Returns: {
          businesses_contacted: number
          callbacks_requested: number
          calls_made: number
          followups_scheduled: number
          interested_prospects: number
          meetings_booked: number
          unanswered_calls: number
          voicemails: number
        }[]
      }
      is_lead_suppressed: { Args: { p_lead_id: string }; Returns: boolean }
      manage_followup: {
        Args: {
          p_action?: string
          p_date?: string
          p_expected: string
          p_id?: string
          p_lead: string
          p_notes?: string
          p_request: string
          p_time?: string
        }
        Returns: string
      }
      manage_page: {
        Args: {
          p_delete?: boolean
          p_description?: string
          p_id: string
          p_name?: string
        }
        Returns: string
      }
      preview_import: { Args: { p_urls: Json }; Returns: number }
      record_call: {
        Args: {
          p_date?: string
          p_expected: string
          p_followup?: string
          p_lead: string
          p_notes?: string
          p_outcome: Database["public"]["Enums"]["call_outcome"]
          p_request: string
          p_time?: string
        }
        Returns: string
      }
      save_lead: {
        Args: {
          p_action?: string
          p_data: Json
          p_expected: string
          p_id: string
        }
        Returns: undefined
      }
      undo_import: { Args: { p_id: string }; Returns: undefined }
      undo_workflow: { Args: { p_id: string }; Returns: undefined }
      workspace_activity: {
        Args: { p_day: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      workspace_followups: {
        Args: {
          p_category?: string
          p_day: string
          p_limit?: number
          p_offset?: number
          p_sort?: string
        }
        Returns: Json
      }
      workspace_lead_history: {
        Args: { p_lead: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      workspace_leads: {
        Args: {
          p_limit?: number
          p_mode?: string
          p_offset?: number
          p_page?: string
          p_phone?: boolean
          p_search?: string
          p_sort?: string
          p_status?: string
        }
        Returns: Json
      }
      workspace_overview: { Args: { p_day: string }; Returns: Json }
      workspace_pages: { Args: never; Returns: Json }
      workspace_state: { Args: never; Returns: Json }
    }
    Enums: {
      archive_reason: "not_interested" | "attempts_exhausted" | "manual"
      call_outcome:
        | "no_answer"
        | "voicemail"
        | "interested"
        | "not_interested"
        | "callback_requested"
        | "meeting_booked"
        | "other"
      event_kind: "call_attempt" | "followup_scheduled" | "meeting_scheduled"
      import_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "rolled_back"
      lead_status:
        | "new"
        | "no_answer"
        | "voicemail"
        | "interested"
        | "not_interested"
        | "follow_up"
        | "meeting_booked"
      operation_kind:
        | "lead_update"
        | "lead_bulk_status"
        | "lead_delete_matching"
        | "import_undo"
        | "lead_restore"
      operation_status:
        | "planned"
        | "approved"
        | "executing"
        | "completed"
        | "failed"
        | "reverted"
      permission_mode: "strict" | "balanced" | "autonomous"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      archive_reason: ["not_interested", "attempts_exhausted", "manual"],
      call_outcome: [
        "no_answer",
        "voicemail",
        "interested",
        "not_interested",
        "callback_requested",
        "meeting_booked",
        "other",
      ],
      event_kind: ["call_attempt", "followup_scheduled", "meeting_scheduled"],
      import_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "rolled_back",
      ],
      lead_status: [
        "new",
        "no_answer",
        "voicemail",
        "interested",
        "not_interested",
        "follow_up",
        "meeting_booked",
      ],
      operation_kind: [
        "lead_update",
        "lead_bulk_status",
        "lead_delete_matching",
        "import_undo",
        "lead_restore",
      ],
      operation_status: [
        "planned",
        "approved",
        "executing",
        "completed",
        "failed",
        "reverted",
      ],
      permission_mode: ["strict", "balanced", "autonomous"],
    },
  },
} as const
