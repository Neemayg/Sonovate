
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "baseline_embeddings": {
                  Row: {
                    "created_at": string,"embedding": (number)[],"model_version_id": string,"owner_id": string,"recording_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"embedding": (number)[],"model_version_id": string,"owner_id": string,"recording_id": string
                  }
                  Update: {
                    "created_at"?: string,"embedding"?: (number)[],"model_version_id"?: string,"owner_id"?: string,"recording_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "baseline_embeddings_model_version_id_fkey"
      columns: ["model_version_id"]
isOneToOne: false
      referencedRelation: "model_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "baseline_embeddings_recording_id_owner_id_fkey"
      columns: ["recording_id","owner_id"]
isOneToOne: false
      referencedRelation: "recordings"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"context_readings": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string,"recording_id": string,"source": string,"unit": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id"?: string,"recording_id": string,"source"?: string,"unit": string,"value": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"recording_id"?: string,"source"?: string,"unit"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "context_readings_recording_id_owner_id_fkey"
      columns: ["recording_id","owner_id"]
isOneToOne: false
      referencedRelation: "recordings"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"machine_alert_episodes": {
                  Row: {
                    "email_attempted_at": string | null,"email_error": string | null,"email_status": string,"ended_at": string | null,"id": string,"machine_id": string,"owner_id": string,"started_at": string,"started_by_prediction_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "email_attempted_at"?: string | null,"email_error"?: string | null,"email_status"?: string,"ended_at"?: string | null,"id"?: string,"machine_id": string,"owner_id": string,"started_at"?: string,"started_by_prediction_id"?: string | null
                  }
                  Update: {
                    "email_attempted_at"?: string | null,"email_error"?: string | null,"email_status"?: string,"ended_at"?: string | null,"id"?: string,"machine_id"?: string,"owner_id"?: string,"started_at"?: string,"started_by_prediction_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "machine_alert_episodes_machine_id_owner_id_fkey"
      columns: ["machine_id","owner_id"]
isOneToOne: false
      referencedRelation: "machines"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "machine_alert_episodes_started_by_prediction_id_fkey"
      columns: ["started_by_prediction_id"]
isOneToOne: false
      referencedRelation: "predictions"
      referencedColumns: ["id"]
    }
                  ]
                },"machine_thresholds": {
                  Row: {
                    "baseline_count": number,"baseline_recording_ids": (string)[],"computed_at": string,"log_mean": number,"log_std": number,"machine_id": string,"model_version_id": string,"owner_id": string,"spread": number,"threshold": number
                  }
                  ComputedFields: never
                  Insert: {
                    "baseline_count": number,"baseline_recording_ids": (string)[],"computed_at"?: string,"log_mean": number,"log_std": number,"machine_id": string,"model_version_id": string,"owner_id": string,"spread": number,"threshold": number
                  }
                  Update: {
                    "baseline_count"?: number,"baseline_recording_ids"?: (string)[],"computed_at"?: string,"log_mean"?: number,"log_std"?: number,"machine_id"?: string,"model_version_id"?: string,"owner_id"?: string,"spread"?: number,"threshold"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "machine_thresholds_machine_id_owner_id_fkey"
      columns: ["machine_id","owner_id"]
isOneToOne: false
      referencedRelation: "machines"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "machine_thresholds_model_version_id_fkey"
      columns: ["model_version_id"]
isOneToOne: false
      referencedRelation: "model_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"machines": {
                  Row: {
                    "created_at": string,"id": string,"location": string | null,"machine_type": Database["public"]['Enums']["machine_type"],"name": string,"notes": string | null,"owner_id": string,"sensitivity": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"location"?: string | null,"machine_type"?: Database["public"]['Enums']["machine_type"],"name": string,"notes"?: string | null,"owner_id"?: string,"sensitivity"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"location"?: string | null,"machine_type"?: Database["public"]['Enums']["machine_type"],"name"?: string,"notes"?: string | null,"owner_id"?: string,"sensitivity"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "machines_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"model_versions": {
                  Row: {
                    "bundle_sha256": string | null,"created_at": string,"evidence_ref": string,"id": string,"limitations": (string)[],"machine_type": Database["public"]['Enums']["machine_type"] | null,"name": string,"preprocessing_version": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bundle_sha256"?: string | null,"created_at"?: string,"evidence_ref": string,"id"?: string,"limitations"?: (string)[],"machine_type"?: Database["public"]['Enums']["machine_type"] | null,"name": string,"preprocessing_version": string,"version": string
                  }
                  Update: {
                    "bundle_sha256"?: string | null,"created_at"?: string,"evidence_ref"?: string,"id"?: string,"limitations"?: (string)[],"machine_type"?: Database["public"]['Enums']["machine_type"] | null,"name"?: string,"preprocessing_version"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"predictions": {
                  Row: {
                    "baseline_count": number | null,"created_at": string,"decision": string,"id": string,"log_score": number | null,"model_version_id": string,"owner_id": string,"recording_id": string,"score": number,"sensitivity": string,"threshold": number,"window_count": number,"window_log_scores": (number)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "baseline_count"?: number | null,"created_at"?: string,"decision": string,"id"?: string,"log_score"?: number | null,"model_version_id": string,"owner_id": string,"recording_id": string,"score": number,"sensitivity"?: string,"threshold": number,"window_count"?: number,"window_log_scores"?: (number)[] | null
                  }
                  Update: {
                    "baseline_count"?: number | null,"created_at"?: string,"decision"?: string,"id"?: string,"log_score"?: number | null,"model_version_id"?: string,"owner_id"?: string,"recording_id"?: string,"score"?: number,"sensitivity"?: string,"threshold"?: number,"window_count"?: number,"window_log_scores"?: (number)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "predictions_model_version_id_fkey"
      columns: ["model_version_id"]
isOneToOne: false
      referencedRelation: "model_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "predictions_recording_id_owner_id_fkey"
      columns: ["recording_id","owner_id"]
isOneToOne: false
      referencedRelation: "recordings"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "alert_emails": boolean,"created_at": string,"display_name": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_emails"?: boolean,"created_at"?: string,"display_name"?: string | null,"id": string
                  }
                  Update: {
                    "alert_emails"?: boolean,"created_at"?: string,"display_name"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recordings": {
                  Row: {
                    "channels": number | null,"created_at": string,"duration_seconds": number | null,"id": string,"kind": Database["public"]['Enums']["recording_kind"],"machine_id": string,"original_filename": string | null,"owner_id": string,"recorded_at": string | null,"sample_rate_hz": number | null,"size_bytes": number | null,"storage_path": string,"upload_completed_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channels"?: number | null,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"kind"?: Database["public"]['Enums']["recording_kind"],"machine_id": string,"original_filename"?: string | null,"owner_id"?: string,"recorded_at"?: string | null,"sample_rate_hz"?: number | null,"size_bytes"?: number | null,"storage_path": string,"upload_completed_at"?: string | null
                  }
                  Update: {
                    "channels"?: number | null,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"kind"?: Database["public"]['Enums']["recording_kind"],"machine_id"?: string,"original_filename"?: string | null,"owner_id"?: string,"recorded_at"?: string | null,"sample_rate_hz"?: number | null,"size_bytes"?: number | null,"storage_path"?: string,"upload_completed_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recordings_machine_id_owner_id_fkey"
      columns: ["machine_id","owner_id"]
isOneToOne: false
      referencedRelation: "machines"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                }
          }
          Views: {
            "machine_alerts": {
                  Row: {
                    "above_threshold_count": number | null,"alert": boolean | null,"analyses_considered": number | null,"last_analysed_at": string | null,"machine_id": string,"owner_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "recordings_machine_id_owner_id_fkey"
      columns: ["machine_id","owner_id"]
isOneToOne: false
      referencedRelation: "machines"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                }
          }
          Functions: {
            "alert_email_target":
{ Args: { "p_episode_id": string }; Returns: {
              "above_threshold_count": number,"alert_emails": boolean,"analyses_considered": number,"email": string,"machine_id": string,"machine_name": string
            }[]
                           },
"sync_machine_alert":
{ Args: { "p_machine_id": string,"p_prediction_id": string }; Returns: string
                           }
          }
          Enums: {
            "machine_type": "bearing"|"gearbox"|"other","recording_kind": "baseline"|"analysis"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "machine_type": ["bearing", "gearbox", "other"],"recording_kind": ["baseline", "analysis"]
          }
        }
} as const
